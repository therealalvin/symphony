# Symphony Music Player: System Summary

Symphony is a full-stack web music player application consisting of a FastAPI backend and a feature-rich HTML/CSS/JavaScript frontend. It is designed to index, organize, stream, and visualize local music libraries with advanced audio processing and recommendation capabilities.

---

## Backend Architecture (`main.py`)
* **FastAPI & SQLite Database**: The backend is powered by FastAPI and maintains a local SQLite database (`library.db`) to store songs and acoustic feature data.
* **Library Synchronization**: Recursively scans music directories for supported audio extensions (such as `.mp3`, `.flac`, `.m4a`, and `.ogg`), indexing metadata and tracking file modification times.
* **Metadata Parsing**: Uses Mutagen to extract song titles, artists, albums, genres, durations, track numbers, years, and embedded cover artwork.
* **Acoustic Feature Extraction**: Leverages FFmpeg for audio decoding and Librosa to extract audio features including tempo (BPM), MFCCs, spectral centroid, spectral rolloff, and chroma vectors.
* **Similarity Matching & Multithreading**: Utilizes Python thread pools for parallel feature extraction and computes distance vectors to enable content-based similarity search.

---

## Frontend & User Interface (`index.html`, `style.css`)
* **Responsive Dark-Themed UI**: Implements a clean dark theme featuring a collapsible sidebar navigation, top control bar, main content area, queue drawer, and bottom player bar.
* **Library Views**: Supports browsing the music library by All Songs (in a tabular layout), Artists, Albums, and Genres (using interactive card grids).
* **Search & Advanced Filtering**: Provides search inputs with specific field filters (Title, Artist, Album, Genre, or Any Field) and interactive active filter chips.
* **Play Queue & Drag-and-Drop**: Includes a slide-out queue drawer that supports drag-and-drop queueing for individual tracks, albums, artists, and genres, as well as track reordering.

---

## Audio Processing & Visualizers (`app.js`)
* **Web Audio API Pipeline**: Routes audio through a Web Audio API graph that includes biquad filter nodes, a dynamics compressor node for gain normalization, and an analyser node.
* **5-Band Equalizer**: Provides adjustable frequency bands (60Hz, 250Hz, 1kHz, 4kHz, and 12kHz) paired with 10 professional presets including Rock, Pop, Jazz, Classical, Dance, Bass Booster, and Acoustic.
* **Music Visualizers**: Offers 7 canvas-rendered visualizer modes: Cosmic Tunnel, Neon Frequency Spectrum, Magnetosphere 3D, Chroma Liquid Diffusion, Synthwave Cyber Grid, Solar Flare Pulsar, and Digital Cyber Vortex.
