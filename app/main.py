import os
import sqlite3
import time
import json
import mimetypes
import warnings
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional, List
from fastapi import FastAPI, HTTPException, Request, Query, Response
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from mutagen import File as MutagenFile
from mutagen.mp4 import MP4
import numpy as np
import librosa

# Suppress librosa warnings in logs
warnings.filterwarnings("ignore", category=UserWarning, module="librosa")
warnings.filterwarnings("ignore", category=FutureWarning, module="librosa")

app = FastAPI(title="Symphony Music Player")

MUSIC_DIR = os.getenv("MUSIC_DIR", "/music")
DB_PATH = os.getenv("DB_PATH", "/data/library.db")

os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS songs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filepath TEXT UNIQUE NOT NULL,
            title TEXT COLLATE NOCASE,
            artist TEXT COLLATE NOCASE,
            album TEXT COLLATE NOCASE,
            genre TEXT COLLATE NOCASE,
            duration REAL,
            track_number INTEGER,
            year TEXT,
            file_mtime REAL,
            date_added REAL
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS song_features (
            song_id INTEGER PRIMARY KEY,
            tempo REAL,
            feature_vector TEXT,
            FOREIGN KEY(song_id) REFERENCES songs(id) ON DELETE CASCADE
        )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_artist ON songs(artist COLLATE NOCASE)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_album ON songs(album COLLATE NOCASE)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_genre ON songs(genre COLLATE NOCASE)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_title ON songs(title COLLATE NOCASE)")
    conn.commit()
    conn.close()

init_db()

SUPPORTED_EXTENSIONS = ('.mp3', '.flac', '.m4a', '.aac', '.ogg', '.wav', '.opus', '.wma', '.aiff')

def load_audio_ffmpeg(filepath: str, target_sr: int = 22050, offset: float = 10.0, duration: float = 30.0) -> Optional[np.ndarray]:
    """Decode audio slice using FFmpeg directly to PCM float32 array."""
    try:
        cmd = [
            'ffmpeg',
            '-ss', str(offset),
            '-t', str(duration),
            '-v', 'error',
            '-i', filepath,
            '-f', 's16le',
            '-ac', '1',
            '-ar', str(target_sr),
            'pipe:1'
        ]
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        out, _ = proc.communicate(timeout=15)

        if proc.returncode != 0 or len(out) < 4096:
            cmd_fb = [
                'ffmpeg',
                '-v', 'error',
                '-i', filepath,
                '-t', str(duration),
                '-f', 's16le',
                '-ac', '1',
                '-ar', str(target_sr),
                'pipe:1'
            ]
            proc_fb = subprocess.Popen(cmd_fb, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            out, _ = proc_fb.communicate(timeout=15)

        if not out or len(out) < 100:
            return None

        audio = np.frombuffer(out, dtype=np.int16).astype(np.float32) / 32768.0
        return audio
    except Exception as e:
        print(f"FFmpeg decode error for {filepath}: {e}")
        return None

def extract_audio_features(filepath: str) -> Optional[dict]:
    """Extract acoustic features (BPM, MFCCs, Spectral Centroid, Rolloff, Chroma) for content similarity."""
    try:
        y = load_audio_ffmpeg(filepath, target_sr=22050, offset=10.0, duration=30.0)
        if y is None or len(y) == 0:
            return None

        sr = 22050

        tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
        tempo_val = float(np.atleast_1d(tempo)[0])

        mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13)
        mfcc_mean = np.mean(mfcc, axis=1)
        mfcc_std = np.std(mfcc, axis=1)

        centroid = librosa.feature.spectral_centroid(y=y, sr=sr)
        centroid_mean = float(np.mean(centroid))

        rolloff = librosa.feature.spectral_rolloff(y=y, sr=sr)
        rolloff_mean = float(np.mean(rolloff))

        chroma = librosa.feature.chroma_stft(y=y, sr=sr)
        chroma_mean = np.mean(chroma, axis=1)

        vector = np.concatenate([
            [tempo_val / 200.0],
            mfcc_mean / 100.0,
            mfcc_std / 100.0,
            [centroid_mean / 5000.0],
            [rolloff_mean / 5000.0],
            chroma_mean
        ]).astype(float).tolist()

        return {
            "tempo": tempo_val,
            "feature_vector": vector
        }
    except Exception as e:
        print(f"Error analyzing features for {filepath}: {e}")
        return None

def parse_metadata(filepath: str):
    default_title = os.path.splitext(os.path.basename(filepath))[0]
    metadata = {
        'title': default_title,
        'artist': 'Unknown Artist',
        'album': 'Unknown Album',
        'genre': 'Unknown Genre',
        'duration': 0.0,
        'track_number': 0,
        'year': ''
    }
    
    try:
        audio = MutagenFile(filepath, easy=True)
        if audio is not None:
            if audio.info and hasattr(audio.info, 'length'):
                metadata['duration'] = float(audio.info.length)
            
            def get_tag(keys):
                for k in keys:
                    if k in audio and audio[k]:
                        val = audio[k][0]
                        return str(val) if val else None
                return None

            title = get_tag(['title'])
            if title: metadata['title'] = title

            artist = get_tag(['artist', 'performer', 'albumartist'])
            if artist: metadata['artist'] = artist

            album = get_tag(['album'])
            if album: metadata['album'] = album

            genre = get_tag(['genre'])
            if genre: metadata['genre'] = genre

            year = get_tag(['date', 'year'])
            if year: metadata['year'] = year[:4] if len(year) >= 4 else year

            track = get_tag(['tracknumber'])
            if track:
                try:
                    metadata['track_number'] = int(str(track).split('/')[0])
                except ValueError:
                    pass
    except Exception as e:
        print(f"Error parsing metadata for {filepath}: {e}")

    return metadata

def extract_cover_art(filepath: str):
    """Extracts embedded artwork from audio files."""
    try:
        audio = MutagenFile(filepath)
        if audio is None:
            return None, None

        if hasattr(audio, 'tags') and audio.tags:
            for key in audio.tags.keys():
                if key.startswith('APIC'):
                    apic = audio.tags[key]
                    return apic.data, apic.mime

        if hasattr(audio, 'pictures') and audio.pictures:
            pic = audio.pictures[0]
            return pic.data, pic.mime

        if isinstance(audio, MP4) and 'covr' in audio.tags:
            covers = audio.tags['covr']
            if covers:
                cover = covers[0]
                mime = 'image/png' if getattr(cover, 'imageformat', None) == MP4.FORMAT_PNG else 'image/jpeg'
                return bytes(cover), mime

    except Exception as e:
        print(f"Error extracting cover art from {filepath}: {e}")

    return None, None

@app.post("/api/sync")
def sync_library():
    """Recursively scans music folder, indexes metadata, and extracts features in parallel using thread pools."""
    if not os.path.exists(MUSIC_DIR):
        raise HTTPException(status_code=404, detail=f"Music directory '{MUSIC_DIR}' not found.")

    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("SELECT id, filepath, file_mtime FROM songs")
    existing_files = {row['filepath']: (row['id'], row['file_mtime']) for row in cursor.fetchall()}

    scanned_paths = set()
    added_count = 0
    updated_count = 0
    pending_feature_tasks = []

    for root, _, files in os.walk(MUSIC_DIR):
        for file in files:
            if file.lower().endswith(SUPPORTED_EXTENSIONS):
                filepath = os.path.join(root, file)
                scanned_paths.add(filepath)

                try:
                    mtime = os.path.getmtime(filepath)
                except OSError:
                    mtime = time.time()

                if filepath not in existing_files:
                    meta = parse_metadata(filepath)
                    cursor.execute("""
                        INSERT INTO songs (filepath, title, artist, album, genre, duration, track_number, year, file_mtime, date_added)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (
                        filepath, meta['title'], meta['artist'], meta['album'], meta['genre'],
                        meta['duration'], meta['track_number'], meta['year'], mtime, mtime
                    ))
                    song_id = cursor.lastrowid
                    added_count += 1
                    pending_feature_tasks.append((song_id, filepath))
                else:
                    song_id, old_mtime = existing_files[filepath]
                    if mtime > old_mtime:
                        meta = parse_metadata(filepath)
                        cursor.execute("""
                            UPDATE songs
                            SET title=?, artist=?, album=?, genre=?, duration=?, track_number=?, year=?, file_mtime=?, date_added=?
                            WHERE id=?
                        """, (
                            meta['title'], meta['artist'], meta['album'], meta['genre'],
                            meta['duration'], meta['track_number'], meta['year'], mtime, mtime, song_id
                        ))
                        updated_count += 1
                        pending_feature_tasks.append((song_id, filepath))

    # Catch any previously unindexed tracks missing from song_features
    cursor.execute("""
        SELECT s.id, s.filepath FROM songs s
        LEFT JOIN song_features f ON s.id = f.song_id
        WHERE f.song_id IS NULL
    """)
    existing_pending_ids = {task[0] for task in pending_feature_tasks}
    for row in cursor.fetchall():
        if row['id'] not in existing_pending_ids:
            pending_feature_tasks.append((row['id'], row['filepath']))

    # Parallel audio feature extraction using threads (avoids multiprocessing fork lockup in uvicorn)
    if pending_feature_tasks:
        print(f"[Sync] Extracting audio features for {len(pending_feature_tasks)} tracks...")
        max_workers = min(16, os.cpu_count() or 8)
        feature_results = []

        def worker_task(item):
            s_id, path = item
            feat = extract_audio_features(path)
            if feat:
                return s_id, feat['tempo'], json.dumps(feat['feature_vector'])
            return None

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = [executor.submit(worker_task, task) for task in pending_feature_tasks]
            for future in as_completed(futures):
                try:
                    res = future.result()
                    if res:
                        feature_results.append(res)
                except Exception as e:
                    print(f"Feature worker error: {e}")

        if feature_results:
            cursor.executemany("""
                INSERT OR REPLACE INTO song_features (song_id, tempo, feature_vector)
                VALUES (?, ?, ?)
            """, feature_results)
            print(f"[Sync] Saved features for {len(feature_results)} tracks.")

    deleted_paths = set(existing_files.keys()) - scanned_paths
    deleted_count = len(deleted_paths)
    for path in deleted_paths:
        cursor.execute("DELETE FROM songs WHERE filepath=?", (path,))

    conn.commit()

    cursor.execute("SELECT COUNT(*) as total FROM songs")
    total_songs = cursor.fetchone()['total']
    conn.close()

    return {
        "status": "success",
        "added": added_count,
        "updated": updated_count,
        "deleted": deleted_count,
        "total": total_songs
    }

@app.get("/api/songs")
def get_songs(
    filter_field: List[str] = Query(default=[]),
    filter_value: List[str] = Query(default=[]),
    sort_by: str = "title",
    order: str = "asc"
):
    conn = get_db()
    cursor = conn.cursor()

    similar_song_id = None
    query_filters = []
    params = []

    valid_fields = {'title', 'artist', 'album', 'genre', 'all'}
    for f_field, f_val in zip(filter_field, filter_value):
        if not f_val:
            continue

        # Intercept queries starting with "similar:"
        if f_val.lower().startswith("similar:"):
            f_field = "similar"
            f_val = f_val[8:].strip()

        if f_field == "similar":
            # Extract numeric song ID if present (e.g. "12", "12:Title", "12 - Title")
            raw_id_part = f_val.split(":")[0].split("-")[0].strip()
            if raw_id_part.isdigit():
                similar_song_id = int(raw_id_part)
            else:
                # Match song ID by title or filepath search
                cursor.execute("SELECT id FROM songs WHERE title LIKE ? OR filepath LIKE ? LIMIT 1", (f"%{f_val}%", f"%{f_val}%"))
                match = cursor.fetchone()
                if match:
                    similar_song_id = match['id']
        elif f_field == "all":
            query_filters.append("(title LIKE ? OR artist LIKE ? OR album LIKE ? OR genre LIKE ?)")
            pattern = f"%{f_val}%"
            params.extend([pattern, pattern, pattern, pattern])
        elif f_field in valid_fields:
            query_filters.append(f"{f_field} LIKE ?")
            params.append(f"%{f_val}%")

    query = "SELECT * FROM songs WHERE 1=1"
    if query_filters:
        query += " AND " + " AND ".join(query_filters)

    valid_sorts = {'title': 'title', 'artist': 'artist', 'album': 'album', 'genre': 'genre', 'date_added': 'date_added'}
    sort_col = valid_sorts.get(sort_by, 'title')
    sort_dir = "DESC" if order.lower() == "desc" else "ASC"

    query += f" ORDER BY {sort_col} {sort_dir}"

    cursor.execute(query, params)
    songs = [dict(row) for row in cursor.fetchall()]

    if similar_song_id is not None:
        print(f"[Similarity] Calculating similarity rankings for Song ID: {similar_song_id}")
        cursor.execute("SELECT feature_vector FROM song_features WHERE song_id=?", (similar_song_id,))
        ref_row = cursor.fetchone()

        ref_vec = None
        if ref_row and ref_row['feature_vector']:
            ref_vec = np.array(json.loads(ref_row['feature_vector']))
        else:
            # On-the-fly extraction if track wasn't previously indexed
            cursor.execute("SELECT filepath FROM songs WHERE id=?", (similar_song_id,))
            s_row = cursor.fetchone()
            if s_row and os.path.exists(s_row['filepath']):
                feat = extract_audio_features(s_row['filepath'])
                if feat:
                    ref_vec = np.array(feat['feature_vector'])
                    cursor.execute("""
                        INSERT OR REPLACE INTO song_features (song_id, tempo, feature_vector)
                        VALUES (?, ?, ?)
                    """, (similar_song_id, feat['tempo'], json.dumps(feat['feature_vector'])))
                    conn.commit()

        if ref_vec is not None:
            cursor.execute("SELECT song_id, feature_vector FROM song_features")
            all_feats = cursor.fetchall()
            feat_dict = {f['song_id']: np.array(json.loads(f['feature_vector'])) for f in all_feats if f['feature_vector']}

            def calc_distance(song):
                if song['id'] == similar_song_id:
                    return -1.0
                vec = feat_dict.get(song['id'])
                if vec is None or len(vec) != len(ref_vec):
                    return 999999.0
                return float(np.linalg.norm(ref_vec - vec))

            songs.sort(key=calc_distance)

    conn.close()
    return songs

@app.get("/api/stats")
def get_stats():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) as song_count FROM songs")
    song_count = cursor.fetchone()['song_count']
    cursor.execute("SELECT COUNT(DISTINCT artist) as artist_count FROM songs")
    artist_count = cursor.fetchone()['artist_count']
    conn.close()
    return {"total_songs": song_count, "total_artists": artist_count}

@app.get("/api/artists")
def get_artists():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT artist, COUNT(DISTINCT album) as album_count, COUNT(*) as song_count
        FROM songs
        GROUP BY artist
        ORDER BY artist COLLATE NOCASE ASC
    """)
    artists = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return artists

@app.get("/api/albums")
def get_albums():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT album, artist, COUNT(*) as song_count
        FROM songs
        GROUP BY album, artist
        ORDER BY album COLLATE NOCASE ASC
    """)
    albums = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return albums

@app.get("/api/genres")
def get_genres():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT genre, COUNT(*) as song_count
        FROM songs
        GROUP BY genre
        ORDER BY genre COLLATE NOCASE ASC
    """)
    genres = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return genres

@app.get("/api/stream/{song_id}")
def stream_song(song_id: int):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT filepath FROM songs WHERE id=?", (song_id,))
    row = cursor.fetchone()
    conn.close()

    if not row or not os.path.exists(row['filepath']):
        raise HTTPException(status_code=404, detail="Song file not found")

    mime_type, _ = mimetypes.guess_type(row['filepath'])
    return FileResponse(row['filepath'], media_type=mime_type or "audio/mpeg")

@app.get("/api/art/{song_id}")
def get_song_art(song_id: int):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT filepath FROM songs WHERE id=?", (song_id,))
    row = cursor.fetchone()
    conn.close()

    if not row or not os.path.exists(row['filepath']):
        raise HTTPException(status_code=404, detail="Song not found")

    art_data, mime_type = extract_cover_art(row['filepath'])
    if not art_data:
        raise HTTPException(status_code=404, detail="No cover art available")

    return Response(content=art_data, media_type=mime_type or "image/jpeg")

@app.get("/api/album-art")
def get_album_art(album: str = Query(...)):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT filepath FROM songs WHERE album=? AND filepath IS NOT NULL", (album,))
    rows = cursor.fetchall()
    conn.close()

    for row in rows:
        if os.path.exists(row['filepath']):
            art_data, mime_type = extract_cover_art(row['filepath'])
            if art_data:
                return Response(content=art_data, media_type=mime_type or "image/jpeg")

    raise HTTPException(status_code=404, detail="No album art found")

@app.get("/api/artist-art")
def get_artist_art(artist: str = Query(...)):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT filepath FROM songs WHERE artist=? AND filepath IS NOT NULL", (artist,))
    rows = cursor.fetchall()
    conn.close()

    for row in rows:
        if os.path.exists(row['filepath']):
            art_data, mime_type = extract_cover_art(row['filepath'])
            if art_data:
                return Response(content=art_data, media_type=mime_type or "image/jpeg")

    raise HTTPException(status_code=404, detail="No artist art found")

app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
def read_root():
    return FileResponse("static/index.html")
