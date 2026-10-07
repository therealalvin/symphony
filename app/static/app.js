class MusicApp {
    constructor() {
        this.songs = [];
        this.queue = [];
        this.currentTrackIndex = -1;
        this.isPlaying = false;
        this.isShuffle = false;
        this.isRepeat = false;

        this.currentView = 'all';
        this.activeFilters = []; 
        this.sortBy = 'title';
        this.sortOrder = 'asc';

        // Web Audio API
        this.audioCtx = null;
        this.audioElement = document.getElementById('audio-element');
        this.compressorNode = null;
        this.analyserNode = null;
        this.isGainNormalized = true;

        // Equalizer State & Presets
        this.eqFrequencies = [60, 250, 1000, 4000, 12000];
        this.eqFilters = [];
        this.eqGains = [0, 0, 0, 0, 0];
        this.isEqEnabled = true;
        this.isEqOpen = false;

        this.eqPresets = {
            flat: [0, 0, 0, 0, 0],
            rock: [4.5, 3.0, -1.0, 2.5, 4.0],
            pop: [-1.5, 2.0, 4.0, 2.0, -1.0],
            jazz: [3.0, 2.0, -1.5, 1.5, 3.5],
            classical: [4.0, 2.5, 0.0, 2.0, 3.0],
            dance: [5.0, 3.5, 0.0, 3.0, 4.5],
            bass: [6.0, 4.5, 1.0, 0.0, 0.0],
            vocal: [-2.0, 1.5, 4.5, 3.0, 0.0],
            acoustic: [3.5, 1.5, 1.0, 2.5, 3.5],
            treble: [0.0, 0.0, 0.0, 3.5, 6.0]
        };

        // Visualizer state
        this.isVizOpen = false;
        this.vizMode = 'itunes';
        this.animFrameId = null;
        this.stars = [];
        this.magnetoParticles = null;
        this.matrixDrops = null;

        this.draggedItemData = null; 

        this.initDOM();
        this.initAudioContext();
        this.bindEvents();
        this.initStars();
        this.loadLibraryStats();
        this.loadSongs();
    }

    initDOM() {
        this.contentContainer = document.getElementById('content-container');
        this.viewTitle = document.getElementById('view-title');
        this.viewSubtitle = document.getElementById('view-subtitle');
        this.searchInput = document.getElementById('search-input');
        this.searchField = document.getElementById('search-field');
        this.addFilterBtn = document.getElementById('add-filter-btn');
        this.activeFiltersContainer = document.getElementById('active-filters');
        
        this.sortBySelect = document.getElementById('sort-by');
        this.sortOrderBtn = document.getElementById('sort-order-btn');
        this.sortOrderIcon = document.getElementById('sort-order-icon');
        
        this.syncBtn = document.getElementById('sync-btn');
        this.syncIcon = document.getElementById('sync-icon');
        this.syncStatus = document.getElementById('sync-status');
        this.statsElem = document.getElementById('library-stats');

        this.btnPlay = document.getElementById('btn-play');
        this.btnPrev = document.getElementById('btn-prev');
        this.btnNext = document.getElementById('btn-next');
        this.btnShuffle = document.getElementById('btn-shuffle');
        this.btnRepeat = document.getElementById('btn-repeat');
        this.seekBar = document.getElementById('seek-bar');
        this.currentTimeElem = document.getElementById('current-time');
        this.durationTimeElem = document.getElementById('duration-time');
        this.volumeBar = document.getElementById('volume-bar');
        this.btnGainToggle = document.getElementById('btn-gain-toggle');
        
        this.btnEqToggle = document.getElementById('btn-eq-toggle');
        this.eqModal = document.getElementById('eq-modal');
        this.closeEqBtn = document.getElementById('close-eq-btn');
        this.eqPresetSelect = document.getElementById('eq-preset-select');
        this.btnEqBypass = document.getElementById('btn-eq-bypass');
        this.eqSliders = document.querySelectorAll('.eq-slider');

        this.playerTitle = document.getElementById('player-title');
        this.playerArtist = document.getElementById('player-artist');
        this.playerArt = document.getElementById('player-art');

        this.queueDrawer = document.getElementById('queue-drawer');
        this.queueListElem = document.getElementById('queue-list');
        this.toggleQueueBtn = document.getElementById('toggle-queue-btn');
        this.queueAllBtn = document.getElementById('queue-all-btn');
        this.replaceQueueAllBtn = document.getElementById('replace-queue-all-btn');

        this.vizOverlay = document.getElementById('visualizer-overlay');
        this.vizCanvas = document.getElementById('visualizer-canvas');
        this.vizSelect = document.getElementById('viz-mode-select');
        this.btnVizToggle = document.getElementById('btn-visualizer');
        this.btnVizClose = document.getElementById('close-viz-btn');
    }

    initAudioContext() {
        const setup = () => {
            if (!this.audioCtx) {
                const AudioContext = window.AudioContext || window.webkitAudioContext;
                this.audioCtx = new AudioContext();

                const source = this.audioCtx.createMediaElementSource(this.audioElement);
                
                this.eqFilters = this.eqFrequencies.map((freq, idx) => {
                    const filter = this.audioCtx.createBiquadFilter();
                    if (idx === 0) {
                        filter.type = 'lowshelf';
                    } else if (idx === this.eqFrequencies.length - 1) {
                        filter.type = 'highshelf';
                    } else {
                        filter.type = 'peaking';
                        filter.Q.setValueAtTime(1.2, this.audioCtx.currentTime);
                    }
                    filter.frequency.setValueAtTime(freq, this.audioCtx.currentTime);
                    filter.gain.setValueAtTime(this.isEqEnabled ? this.eqGains[idx] : 0, this.audioCtx.currentTime);
                    return filter;
                });

                this.compressorNode = this.audioCtx.createDynamicsCompressor();
                this.compressorNode.threshold.setValueAtTime(this.isGainNormalized ? -24 : 0, this.audioCtx.currentTime);
                this.compressorNode.ratio.setValueAtTime(12, this.audioCtx.currentTime);

                this.analyserNode = this.audioCtx.createAnalyser();
                this.analyserNode.fftSize = 512;

                let currentNode = source;
                this.eqFilters.forEach(filter => {
                    currentNode.connect(filter);
                    currentNode = filter;
                });
                currentNode.connect(this.compressorNode);
                this.compressorNode.connect(this.analyserNode);
                this.analyserNode.connect(this.audioCtx.destination);
            }
            if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
        };

        window.addEventListener('click', setup, { once: true });
        this.ensureAudioContext = setup;
    }

    bindEvents() {
        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.switchView(btn.dataset.view);
            });
        });

        this.syncBtn.addEventListener('click', () => this.syncLibrary());

        this.sortBySelect.addEventListener('change', (e) => {
            this.sortBy = e.target.value;
            this.loadSongs();
        });

        this.sortOrderBtn.addEventListener('click', () => {
            this.sortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc';
            this.sortOrderIcon.className = this.sortOrder === 'asc' ? 'fa-solid fa-arrow-up-a-z' : 'fa-solid fa-arrow-down-z-a';
            this.loadSongs();
        });

        this.addFilterBtn.addEventListener('click', () => this.addSearchFilter());
        this.searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addSearchFilter();
        });

        this.btnPlay.addEventListener('click', () => this.togglePlay());
        this.btnPrev.addEventListener('click', () => this.playPrev());
        this.btnNext.addEventListener('click', () => this.playNext());

        this.btnShuffle.addEventListener('click', () => {
            this.isShuffle = !this.isShuffle;
            this.btnShuffle.classList.toggle('active', this.isShuffle);
        });

        this.btnRepeat.addEventListener('click', () => {
            this.isRepeat = !this.isRepeat;
            this.btnRepeat.classList.toggle('active', this.isRepeat);
        });

        this.audioElement.addEventListener('timeupdate', () => this.updateProgress());
        this.audioElement.addEventListener('ended', () => this.playNext());

        this.seekBar.addEventListener('input', (e) => {
            if (this.audioElement.duration) {
                this.audioElement.currentTime = (e.target.value / 100) * this.audioElement.duration;
            }
        });

        this.volumeBar.addEventListener('input', (e) => {
            const val = e.target.value / 100;
            this.audioElement.volume = val;
            const volIcon = document.getElementById('volume-icon');
            if (volIcon) {
                if (val === 0) volIcon.className = 'fa-solid fa-volume-xmark';
                else if (val < 0.5) volIcon.className = 'fa-solid fa-volume-low';
                else volIcon.className = 'fa-solid fa-volume-high';
            }
        });

        this.btnGainToggle.addEventListener('click', () => {
            this.isGainNormalized = !this.isGainNormalized;
            this.btnGainToggle.classList.toggle('active-gain', this.isGainNormalized);
            if (this.compressorNode && this.audioCtx) {
                this.compressorNode.threshold.setValueAtTime(this.isGainNormalized ? -24 : 0, this.audioCtx.currentTime);
            }
        });

        this.btnEqToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            if (typeof this.ensureAudioContext === 'function') this.ensureAudioContext();
            this.toggleEqModal();
        });

        this.closeEqBtn.addEventListener('click', () => this.closeEqModal());
        this.eqPresetSelect.addEventListener('change', (e) => this.applyEqPreset(e.target.value));
        this.btnEqBypass.addEventListener('click', () => this.toggleEqBypass());

        this.eqSliders.forEach(slider => {
            slider.addEventListener('input', (e) => {
                const bandIndex = parseInt(e.target.dataset.band);
                const gainValue = parseFloat(e.target.value);
                this.updateEqBand(bandIndex, gainValue);
            });
        });

        document.addEventListener('click', (e) => {
            if (this.isEqOpen && !this.eqModal.contains(e.target) && !this.btnEqToggle.contains(e.target)) {
                this.closeEqModal();
            }
        });

        this.toggleQueueBtn.addEventListener('click', () => this.queueDrawer.classList.toggle('closed'));
        this.queueAllBtn.addEventListener('click', () => this.queueAllResults());
        if (this.replaceQueueAllBtn) {
            this.replaceQueueAllBtn.addEventListener('click', () => this.replaceQueueWithAllResults());
        }

        document.getElementById('close-queue-btn').addEventListener('click', () => this.queueDrawer.classList.add('closed'));
        document.getElementById('clear-queue-btn').addEventListener('click', () => {
            this.queue = [];
            this.currentTrackIndex = -1;
            this.renderQueue();
        });

        this.btnVizToggle.addEventListener('click', () => this.openVisualizer());
        this.btnVizClose.addEventListener('click', () => this.closeVisualizer());
        this.vizSelect.addEventListener('change', (e) => this.vizMode = e.target.value);

        this.setupQueueDragAndDrop();
    }

    addSearchFilter() {
        const field = this.searchField.value;
        const value = this.searchInput.value.trim();
        if(!value) return;
        
        this.activeFilters.push({ field, value });
        this.searchInput.value = '';
        this.renderActiveFilters();

        if (this.currentView !== 'all') {
            document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
            document.querySelector('.nav-item[data-view="all"]').classList.add('active');
            this.switchView('all');
        } else {
            this.loadSongs();
        }
    }

    addSimilarFilter(songId, songTitle) {
        const displayTitle = songTitle.length > 18 ? songTitle.substring(0, 18) + '…' : songTitle;
        this.activeFilters.push({
            field: 'similar',
            value: String(songId),
            displayTitle: displayTitle
        });
        this.renderActiveFilters();

        if (this.currentView !== 'all') {
            document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
            document.querySelector('.nav-item[data-view="all"]').classList.add('active');
            this.switchView('all');
        } else {
            this.loadSongs();
        }
    }

    removeSearchFilter(index) {
        this.activeFilters.splice(index, 1);
        this.renderActiveFilters();
        this.loadSongs();
    }

    renderActiveFilters() {
        this.activeFiltersContainer.innerHTML = '';
        this.activeFilters.forEach((f, idx) => {
            const chip = document.createElement('div');
            chip.className = 'filter-chip';
            
            let labelText = '';
            if (f.field === 'similar') {
                labelText = `<span>SIMILAR TO:</span> ${this.escape(f.displayTitle || f.value)}`;
            } else {
                labelText = `<span>${this.escape(f.field).toUpperCase()}:</span> ${this.escape(f.value)}`;
            }

            chip.innerHTML = `${labelText} <button title="Remove Filter"><i class="fa-solid fa-xmark"></i></button>`;
            chip.querySelector('button').addEventListener('click', () => this.removeSearchFilter(idx));
            this.activeFiltersContainer.appendChild(chip);
        });
    }

    toggleEqModal() {
        this.isEqOpen = !this.isEqOpen;
        this.eqModal.classList.toggle('hidden', !this.isEqOpen);
        this.btnEqToggle.classList.toggle('active-eq', this.isEqOpen);
    }

    closeEqModal() {
        this.isEqOpen = false;
        this.eqModal.classList.add('hidden');
        this.btnEqToggle.classList.remove('active-eq');
    }

    applyEqPreset(presetName) {
        if (typeof this.ensureAudioContext === 'function') this.ensureAudioContext();
        const gains = this.eqPresets[presetName];
        if (!gains) return;

        this.eqGains = [...gains];
        this.eqSliders.forEach((slider, idx) => {
            slider.value = this.eqGains[idx];
            this.updateEqSliderDisplay(idx, this.eqGains[idx]);
        });

        this.applyEqGainsToNodes();
    }

    updateEqBand(bandIndex, gainValue) {
        if (typeof this.ensureAudioContext === 'function') this.ensureAudioContext();
        this.eqGains[bandIndex] = gainValue;
        this.updateEqSliderDisplay(bandIndex, gainValue);
        this.eqPresetSelect.value = 'custom';
        this.applyEqGainsToNodes();
    }

    updateEqSliderDisplay(index, gainValue) {
        const valElem = document.getElementById(`eq-val-${index}`);
        if (valElem) {
            const formatted = gainValue > 0 ? `+${gainValue.toFixed(1)} dB` : `${gainValue.toFixed(1)} dB`;
            valElem.textContent = formatted;
        }
    }

    applyEqGainsToNodes() {
        if (!this.eqFilters || !this.eqFilters.length) return;
        this.eqFilters.forEach((filter, idx) => {
            const targetGain = this.isEqEnabled ? this.eqGains[idx] : 0;
            if (this.audioCtx) {
                filter.gain.setTargetAtTime(targetGain, this.audioCtx.currentTime, 0.03);
            }
        });
    }

    toggleEqBypass() {
        this.isEqEnabled = !this.isEqEnabled;
        this.btnEqBypass.classList.toggle('active', this.isEqEnabled);
        this.btnEqBypass.textContent = this.isEqEnabled ? 'ON' : 'OFF';
        this.applyEqGainsToNodes();
    }

    setupQueueDragAndDrop() {
        const drawer = this.queueDrawer;
        drawer.addEventListener('dragover', (e) => {
            e.preventDefault();
            drawer.classList.add('drag-over');
        });

        drawer.addEventListener('dragleave', () => drawer.classList.remove('drag-over'));

        drawer.addEventListener('drop', async (e) => {
            e.preventDefault();
            drawer.classList.remove('drag-over');

            if (!this.draggedItemData) return;

            if (this.draggedItemData.type === 'song') {
                this.addToQueue(this.draggedItemData.song);
            } else if (['artist', 'album', 'genre'].includes(this.draggedItemData.type)) {
                const res = await fetch(`/api/songs?filter_field=${this.draggedItemData.type}&filter_value=${encodeURIComponent(this.draggedItemData.value)}`);
                const songsToQueue = await res.json();
                songsToQueue.forEach(s => this.addToQueue(s));
            }
            this.draggedItemData = null;
        });
    }

    async loadLibraryStats() {
        const res = await fetch('/api/stats');
        const data = await res.json();
        this.statsElem.innerHTML = `<span>${data.total_songs} Songs</span> • <span>${data.total_artists} Artists</span>`;
    }

    async syncLibrary() {
        this.syncIcon.classList.add('spin-slow');
        this.syncStatus.textContent = 'Syncing...';
        try {
            const res = await fetch('/api/sync', { method: 'POST' });
            const data = await res.json();
            this.syncStatus.textContent = `Done! +${data.added} / -${data.deleted}`;
            this.loadLibraryStats();
            this.loadSongs();
        } catch (e) {
            this.syncStatus.textContent = 'Sync failed';
        } finally {
            this.syncIcon.classList.remove('spin-slow');
        }
    }

    switchView(view) {
        this.currentView = view;
        this.searchInput.value = '';
        if (view === 'all') {
            this.viewTitle.textContent = 'All Songs';
            this.loadSongs();
        } else if (view === 'artists') {
            this.viewTitle.textContent = 'Artists';
            this.loadArtists();
        } else if (view === 'albums') {
            this.viewTitle.textContent = 'Albums';
            this.loadAlbums();
        } else if (view === 'genres') {
            this.viewTitle.textContent = 'Genres';
            this.loadGenres();
        }
    }

    async loadSongs() {
        let url = new URL('/api/songs', window.location.origin);
        url.searchParams.append('sort_by', this.sortBy);
        url.searchParams.append('order', this.sortOrder);
        this.activeFilters.forEach(f => {
            url.searchParams.append('filter_field', f.field);
            url.searchParams.append('filter_value', f.value);
        });

        const res = await fetch(url);
        this.songs = await res.json();
        this.viewSubtitle.textContent = `${this.songs.length} tracks`;
        this.renderSongsTable(this.songs);
    }

    renderSongsTable(songList) {
        if (!songList.length) {
            this.contentContainer.innerHTML = `<p style="color:var(--text-muted)">No tracks found.</p>`;
            return;
        }

        let html = `
            <table class="songs-table">
                <thead>
                    <tr><th>#</th><th>Title</th><th>Artist</th><th>Album</th><th>Genre</th><th>Duration</th><th>Date Added</th><th>Actions</th></tr>
                </thead>
                <tbody>
        `;

        songList.forEach((song, idx) => {
            const isCurrent = this.queue[this.currentTrackIndex]?.id === song.id;
            const artUrl = `/api/art/${song.id}`;
            html += `
                <tr class="song-row ${isCurrent ? 'playing' : ''}" draggable="true" data-id="${song.id}">
                    <td>${idx + 1}</td>
                    <td>
                        <div class="song-title-cell">
                            <img class="song-art-thumb" src="${artUrl}" alt="" onerror="this.onerror=null; this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'38\\' height=\\'38\\' viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'%236366f1\\' stroke-width=\\'2\\'><path d=\\'M9 18V5l12-2v13\\'/><circle cx=\\'6\\' cy=\\'18\\' r=\\'3\\'/><circle cx=\\'18\\' cy=\\'16\\' r=\\'3\\'/></svg>';">
                            <strong>${this.escape(song.title)}</strong>
                        </div>
                    </td>
                    <td>${this.escape(song.artist)}</td>
                    <td>${this.escape(song.album)}</td>
                    <td>${this.escape(song.genre)}</td>
                    <td>${this.formatTime(song.duration)}</td>
                    <td style="color:var(--text-muted); font-size:0.8rem;">${this.formatDate(song.date_added)}</td>
                    <td>
                        <div class="action-buttons-cell">
                            <button class="btn-icon find-similar-btn" data-id="${song.id}" data-title="${this.escape(song.title)}" title="Find Similar Songs">
                                <i class="fa-solid fa-wand-magic-sparkles"></i>
                            </button>
                            <button class="btn-icon add-queue-btn" data-id="${song.id}" title="Add to Queue">
                                <i class="fa-solid fa-plus"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        });
        html += `</tbody></table>`;
        this.contentContainer.innerHTML = html;

        this.contentContainer.querySelectorAll('.song-row').forEach(row => {
            row.addEventListener('click', (e) => {
                if (e.target.closest('.add-queue-btn') || e.target.closest('.find-similar-btn')) return;
                const id = parseInt(row.dataset.id);
                const song = songList.find(s => s.id === id);
                this.playSongNow(song);
            });

            row.addEventListener('dragstart', () => {
                const id = parseInt(row.dataset.id);
                const song = songList.find(s => s.id === id);
                this.draggedItemData = { type: 'song', song };
                row.classList.add('dragging');
            });

            row.addEventListener('dragend', () => row.classList.remove('dragging'));
        });

        this.contentContainer.querySelectorAll('.add-queue-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = parseInt(btn.dataset.id);
                this.addToQueue(songList.find(s => s.id === id));
            });
        });

        this.contentContainer.querySelectorAll('.find-similar-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = parseInt(btn.dataset.id);
                const title = btn.dataset.title;
                this.addSimilarFilter(id, title);
            });
        });
    }

    async loadArtists() {
        const res = await fetch('/api/artists');
        const artists = await res.json();
        this.viewSubtitle.textContent = `${artists.length} artists`;
        let html = `<div class="cards-grid">`;
        artists.forEach(a => {
            const artUrl = `/api/artist-art?artist=${encodeURIComponent(a.artist)}`;
            html += `
                <div class="card artist-card" draggable="true" data-type="artist" data-value="${this.escape(a.artist)}">
                    <div class="card-icon artist-icon">
                        <img src="${artUrl}" alt="${this.escape(a.artist)}" onerror="this.onerror=null; this.parentNode.innerHTML='<i class=\\'fa-solid fa-user\\'></i>';">
                    </div>
                    <div class="card-title">${this.escape(a.artist)}</div>
                    <div class="card-subtitle">${a.album_count} Albums • ${a.song_count} Tracks</div>
                </div>
            `;
        });
        html += `</div>`;
        this.contentContainer.innerHTML = html;
        this.bindCardClicksAndDrag('artist');
    }

    async loadAlbums() {
        const res = await fetch('/api/albums');
        const albums = await res.json();
        this.viewSubtitle.textContent = `${albums.length} albums`;
        let html = `<div class="cards-grid">`;
        albums.forEach(a => {
            const artUrl = `/api/album-art?album=${encodeURIComponent(a.album)}`;
            html += `
                <div class="card album-card" draggable="true" data-type="album" data-value="${this.escape(a.album)}">
                    <div class="card-icon album-icon">
                        <img src="${artUrl}" alt="${this.escape(a.album)}" onerror="this.onerror=null; this.parentNode.innerHTML='<i class=\\'fa-solid fa-compact-disc\\'></i>';">
                    </div>
                    <div class="card-title">${this.escape(a.album)}</div>
                    <div class="card-subtitle">${this.escape(a.artist)}</div>
                </div>
            `;
        });
        html += `</div>`;
        this.contentContainer.innerHTML = html;
        this.bindCardClicksAndDrag('album');
    }

    async loadGenres() {
        const res = await fetch('/api/genres');
        const genres = await res.json();
        this.viewSubtitle.textContent = `${genres.length} genres`;
        let html = `<div class="cards-grid">`;
        genres.forEach(g => {
            html += `
                <div class="card genre-card" draggable="true" data-type="genre" data-value="${this.escape(g.genre)}">
                    <div class="card-icon"><i class="fa-solid fa-guitar"></i></div>
                    <div class="card-title">${this.escape(g.genre)}</div>
                    <div class="card-subtitle">${g.song_count} Tracks</div>
                </div>
            `;
        });
        html += `</div>`;
        this.contentContainer.innerHTML = html;
        this.bindCardClicksAndDrag('genre');
    }

    bindCardClicksAndDrag(type) {
        this.contentContainer.querySelectorAll(`.card`).forEach(card => {
            card.addEventListener('click', () => {
                const val = card.dataset.value;
                this.activeFilters.push({ field: type, value: val });
                this.renderActiveFilters();

                document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
                document.querySelector('.nav-item[data-view="all"]').classList.add('active');
                this.switchView('all'); 
            });

            card.addEventListener('dragstart', () => {
                this.draggedItemData = { type, value: card.dataset.value };
                card.classList.add('dragging');
            });

            card.addEventListener('dragend', () => card.classList.remove('dragging'));
        });
    }

    playSongNow(song, contextList = []) {
        if (contextList && contextList.length > 0) {
            this.queue = [...contextList];
            this.currentTrackIndex = this.queue.findIndex(s => s.id === song.id);
        } else {
            const existingIdx = this.queue.findIndex(s => s.id === song.id);
            if (existingIdx !== -1) {
                this.currentTrackIndex = existingIdx;
            } else {
                if (this.currentTrackIndex >= 0 && this.currentTrackIndex < this.queue.length) {
                    this.queue.splice(this.currentTrackIndex + 1, 0, song);
                    this.currentTrackIndex++;
                } else {
                    this.queue.push(song);
                    this.currentTrackIndex = this.queue.length - 1;
                }
            }
        }
        this.renderQueue();
        this.loadAndPlayCurrent();
    }

    addToQueue(song) {
        this.queue.push(song);
        if (this.currentTrackIndex === -1) {
            this.currentTrackIndex = 0;
            this.loadAndPlayCurrent();
        }
        this.renderQueue();
    }

    queueAllResults() {
        if (!this.songs || !this.songs.length) return;
        const startIndex = this.queue.length;
        this.queue.push(...this.songs);
        if (this.currentTrackIndex === -1) {
            this.currentTrackIndex = startIndex;
            this.loadAndPlayCurrent();
        }
        this.renderQueue();
    }

    replaceQueueWithAllResults() {
        if (!this.songs || !this.songs.length) return;
        this.queue = [...this.songs];
        this.currentTrackIndex = 0;
        this.renderQueue();
        this.loadAndPlayCurrent();
    }

    removeFromQueue(index) {
        if (index < 0 || index >= this.queue.length) return;
        this.queue.splice(index, 1);
        if (index === this.currentTrackIndex) {
            if (this.queue.length > 0) {
                this.currentTrackIndex = this.currentTrackIndex % this.queue.length;
                this.loadAndPlayCurrent();
            } else {
                this.currentTrackIndex = -1;
                this.audioElement.pause();
                this.isPlaying = false;
                this.btnPlay.innerHTML = `<i class="fa-solid fa-play"></i>`;
                this.playerTitle.textContent = "No Track Selected";
                this.playerArtist.textContent = "—";
                this.playerArt.innerHTML = `<i class="fa-solid fa-music"></i>`;
            }
        } else if (index < this.currentTrackIndex) {
            this.currentTrackIndex--;
        }
        this.renderQueue();
    }

    renderQueue() {
        if (!this.queue.length) {
            this.queueListElem.innerHTML = `<p class="empty-msg">Queue is empty</p>`;
            return;
        }
        let html = '';
        this.queue.forEach((song, idx) => {
            const isActive = idx === this.currentTrackIndex;
            html += `
                <div class="queue-item ${isActive ? 'active' : ''}" draggable="true" data-index="${idx}">
                    <i class="fa-solid fa-grip-vertical drag-handle"></i>
                    <div class="queue-item-info">
                        <div class="queue-item-title">${this.escape(song.title)}</div>
                        <div class="queue-item-artist">${this.escape(song.artist)}</div>
                    </div>
                    <button class="remove-queue-btn" data-index="${idx}" title="Remove track"><i class="fa-solid fa-trash-can"></i></button>
                </div>
            `;
        });
        this.queueListElem.innerHTML = html;

        let draggedQueueIdx = null;

        this.queueListElem.querySelectorAll('.queue-item').forEach(item => {
            item.addEventListener('dragstart', (e) => {
                draggedQueueIdx = parseInt(item.dataset.index);
                e.stopPropagation();
            });

            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                item.classList.add('drag-over-item');
            });

            item.addEventListener('dragleave', () => item.classList.remove('drag-over-item'));

            item.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                item.classList.remove('drag-over-item');
                const dropIdx = parseInt(item.dataset.index);

                if (draggedQueueIdx !== null && draggedQueueIdx !== dropIdx) {
                    const movedItem = this.queue.splice(draggedQueueIdx, 1)[0];
                    this.queue.splice(dropIdx, 0, movedItem);

                    if (this.currentTrackIndex === draggedQueueIdx) {
                        this.currentTrackIndex = dropIdx;
                    } else if (draggedQueueIdx < this.currentTrackIndex && dropIdx >= this.currentTrackIndex) {
                        this.currentTrackIndex--;
                    } else if (draggedQueueIdx > this.currentTrackIndex && dropIdx <= this.currentTrackIndex) {
                        this.currentTrackIndex++;
                    }

                    this.renderQueue();
                }
            });
        });

        this.queueListElem.querySelectorAll('.remove-queue-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.dataset.index);
                this.removeFromQueue(idx);
            });
        });
    }

    loadAndPlayCurrent() {
        if (this.currentTrackIndex < 0 || this.currentTrackIndex >= this.queue.length) return;
        const song = this.queue[this.currentTrackIndex];
        this.audioElement.src = `/api/stream/${song.id}`;
        this.audioElement.play();
        this.isPlaying = true;
        this.btnPlay.innerHTML = `<i class="fa-solid fa-pause"></i>`;
        this.playerTitle.textContent = song.title;
        this.playerArtist.textContent = `${song.artist} — ${song.album}`;
        
        const artUrl = `/api/art/${song.id}`;
        this.playerArt.innerHTML = `<img src="${artUrl}" alt="Cover" onerror="this.onerror=null; this.parentNode.innerHTML='<i class=\\'fa-solid fa-music\\'></i>';">`;

        document.getElementById('viz-track-title').textContent = `${song.title} - ${song.artist}`;
    }

    togglePlay() {
        if (!this.audioElement.src) return;
        if (this.isPlaying) {
            this.audioElement.pause();
            this.btnPlay.innerHTML = `<i class="fa-solid fa-play"></i>`;
        } else {
            this.audioElement.play();
            this.btnPlay.innerHTML = `<i class="fa-solid fa-pause"></i>`;
        }
        this.isPlaying = !this.isPlaying;
    }

    playNext() {
        if (!this.queue.length) return;
        this.currentTrackIndex = (this.currentTrackIndex + 1) % this.queue.length;
        this.loadAndPlayCurrent();
        this.renderQueue();
    }

    playPrev() {
        if (!this.queue.length) return;
        this.currentTrackIndex = (this.currentTrackIndex - 1 + this.queue.length) % this.queue.length;
        this.loadAndPlayCurrent();
        this.renderQueue();
    }

    updateProgress() {
        if (!this.audioElement.duration) return;
        this.seekBar.value = (this.audioElement.currentTime / this.audioElement.duration) * 100;
        this.currentTimeElem.textContent = this.formatTime(this.audioElement.currentTime);
        this.durationTimeElem.textContent = this.formatTime(this.audioElement.duration);
    }

    initStars() {
        this.stars = [];
        for (let i = 0; i < 300; i++) {
            this.stars.push({
                x: (Math.random() - 0.5) * 2000,
                y: (Math.random() - 0.5) * 2000,
                z: Math.random() * 1000 + 1,
                size: Math.random() * 2 + 1
            });
        }
    }

    openVisualizer() {
        this.vizOverlay.classList.remove('hidden');
        this.isVizOpen = true;
        this.vizCanvas.width = window.innerWidth;
        this.vizCanvas.height = window.innerHeight;
        this.runVisualizerLoop();
    }

    closeVisualizer() {
        this.vizOverlay.classList.add('hidden');
        this.isVizOpen = false;
        if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
    }

    runVisualizerLoop() {
        if (!this.isVizOpen) return;
        const ctx = this.vizCanvas.getContext('2d');
        const bufferLength = this.analyserNode ? this.analyserNode.frequencyBinCount : 128;
        const dataArray = new Uint8Array(bufferLength);
        const waveData = new Uint8Array(bufferLength);
        let angleAcc = 0;

        const draw = () => {
            if (!this.isVizOpen) return;
            this.animFrameId = requestAnimationFrame(draw);
            if (this.analyserNode) {
                this.analyserNode.getByteFrequencyData(dataArray);
                this.analyserNode.getByteTimeDomainData(waveData);
            }

            const cx = this.vizCanvas.width / 2;
            const cy = this.vizCanvas.height / 2;

            if (this.vizMode === 'itunes') {
                let bassSum = 0;
                for (let i = 0; i < 15; i++) bassSum += dataArray[i];
                const bassAvg = bassSum / 15;
                const speedBoost = (bassAvg / 255) * 15 + 2;

                ctx.fillStyle = 'rgba(5, 5, 12, 0.25)';
                ctx.fillRect(0, 0, this.vizCanvas.width, this.vizCanvas.height);

                this.stars.forEach(star => {
                    star.z -= speedBoost;
                    if (star.z <= 0) {
                        star.z = 1000;
                        star.x = (Math.random() - 0.5) * 2000;
                        star.y = (Math.random() - 0.5) * 2000;
                    }

                    const k = 400 / star.z;
                    const px = star.x * k + cx;
                    const py = star.y * k + cy;

                    if (px >= 0 && px <= this.vizCanvas.width && py >= 0 && py <= this.vizCanvas.height) {
                        const alpha = 1 - star.z / 1000;
                        ctx.fillStyle = `rgba(180, 210, 255, ${alpha})`;
                        ctx.beginPath();
                        ctx.arc(px, py, star.size * k * 0.5, 0, Math.PI * 2);
                        ctx.fill();
                    }
                });

                angleAcc += 0.015;
                for (let i = 0; i < bufferLength; i++) {
                    const percent = dataArray[i] / 255;
                    const radius = percent * (this.vizCanvas.height * 0.28) + 50;
                    const angle = (i / bufferLength) * Math.PI * 2 + angleAcc;

                    const x = cx + Math.cos(angle) * radius;
                    const y = cy + Math.sin(angle) * radius;
                    const hue = (i * 3 + Date.now() * 0.04) % 360;

                    ctx.strokeStyle = `hsla(${hue}, 85%, 60%, ${percent + 0.2})`;
                    ctx.lineWidth = percent * 6 + 1;
                    ctx.beginPath();
                    ctx.moveTo(cx, cy);
                    ctx.lineTo(x, y);
                    ctx.stroke();
                }

            } else if (this.vizMode === 'bars') {
                ctx.fillStyle = 'rgba(5, 5, 12, 0.25)';
                ctx.fillRect(0, 0, this.vizCanvas.width, this.vizCanvas.height);
                
                const usefulBins = Math.floor(bufferLength * 0.65);
                const barWidth = (this.vizCanvas.width / usefulBins);
                let x = 0;
                
                for (let i = 0; i < usefulBins; i++) {
                    const boost = 1 + (i / usefulBins) * 0.5;
                    const value = Math.min(255, dataArray[i] * boost);
                    
                    const barHeight = (value / 255) * this.vizCanvas.height * 0.7;
                    ctx.fillStyle = `hsl(${(i / usefulBins) * 320}, 90%, 60%)`;
                    ctx.fillRect(x, this.vizCanvas.height - barHeight, barWidth - 2, barHeight);
                    x += barWidth;
                }

            } else if (this.vizMode === 'magnetosphere') {
                ctx.fillStyle = 'rgba(5, 5, 12, 0.4)';
                ctx.fillRect(0, 0, this.vizCanvas.width, this.vizCanvas.height);

                if (!this.magnetoParticles) {
                    this.magnetoParticles = [];
                    const numParticles = 350;
                    for (let i = 0; i < numParticles; i++) {
                        const phi = Math.acos(1 - 2 * (i + 0.5) / numParticles);
                        const theta = Math.PI * (1 + Math.sqrt(5)) * i;
                        this.magnetoParticles.push({
                            baseX: Math.cos(theta) * Math.sin(phi),
                            baseY: Math.sin(theta) * Math.sin(phi),
                            baseZ: Math.cos(phi),
                            randomOffset: Math.random() * Math.PI * 2
                        });
                    }
                }

                const time = Date.now() * 0.0006;
                const baseRadius = Math.min(this.vizCanvas.width, this.vizCanvas.height) * 0.25;
                
                let bass = 0;
                for (let i = 0; i < 15; i++) bass += dataArray[i];
                const bassBoost = (bass / (15 * 255));

                const projected = [];
                for (let i = 0; i < this.magnetoParticles.length; i++) {
                    const p = this.magnetoParticles[i];
                    const binIdx = Math.floor((i / this.magnetoParticles.length) * (bufferLength * 0.6));
                    const audioVal = dataArray[binIdx] / 255.0;
                    
                    const wave = Math.sin(p.baseY * 5 + time + p.randomOffset) * 0.15;
                    const curRadius = baseRadius * (1 + audioVal * 0.8 + bassBoost * 0.3 + wave);

                    const rotY = time * 0.8;
                    const rotX = time * 0.5 + Math.sin(time * 0.3) * 0.4;

                    let x = p.baseX * curRadius;
                    let y = p.baseY * curRadius;
                    let z = p.baseZ * curRadius;

                    let tx = x * Math.cos(rotY) - z * Math.sin(rotY);
                    let tz = x * Math.sin(rotY) + z * Math.cos(rotY);
                    x = tx; z = tz;

                    let ty = y * Math.cos(rotX) - z * Math.sin(rotX);
                    tz = y * Math.sin(rotX) + z * Math.cos(rotX);
                    y = ty; z = tz;

                    projected.push({ x, y, z, origIndex: i, audioVal });
                }

                projected.sort((a, b) => a.z - b.z);
                const perspective = 800;

                for (let i = 0; i < projected.length; i++) {
                    const p = projected[i];
                    const scale = perspective / (perspective - p.z);
                    if (scale < 0) continue; 

                    const px = cx + p.x * scale;
                    const py = cy + p.y * scale;

                    const size = Math.max(1, (p.audioVal * 5 + 1.5) * scale);
                    const hue = (p.origIndex + time * 120) % 360;
                    
                    const depthAlpha = Math.min(1, Math.max(0.1, (p.z + baseRadius * 2) / (baseRadius * 4)));
                    const intensity = p.audioVal * 0.6 + 0.4;
                    
                    ctx.fillStyle = `hsla(${hue}, 100%, 70%, ${depthAlpha * intensity})`;
                    ctx.beginPath();
                    ctx.arc(px, py, size, 0, Math.PI * 2);
                    ctx.fill();
                }

            } else if (this.vizMode === 'chroma_fluid') {
                ctx.fillStyle = 'rgba(5, 5, 12, 0.18)';
                ctx.fillRect(0, 0, this.vizCanvas.width, this.vizCanvas.height);

                const time = Date.now() * 0.001;
                let bassAvg = 0;
                for (let i = 0; i < 20; i++) bassAvg += dataArray[i];
                bassAvg /= 20;
                const bassNorm = bassAvg / 255;

                const blobCount = 12;
                for (let i = 0; i < blobCount; i++) {
                    const angle = (i / blobCount) * Math.PI * 2 + time * 0.5;
                    const dist = Math.sin(time * 0.8 + i) * 120 + 80 + bassNorm * 100;
                    const x = cx + Math.cos(angle) * dist;
                    const y = cy + Math.sin(angle) * dist;
                    
                    const freqIdx = Math.floor((i / blobCount) * bufferLength * 0.5);
                    const size = (dataArray[freqIdx] / 255) * 180 + 40;

                    const grad = ctx.createRadialGradient(x, y, 5, x, y, size);
                    const hue = (i * 30 + time * 50) % 360;
                    grad.addColorStop(0, `hsla(${hue}, 100%, 65%, 0.8)`);
                    grad.addColorStop(0.5, `hsla(${(hue + 40) % 360}, 90%, 50%, 0.3)`);
                    grad.addColorStop(1, 'transparent');

                    ctx.fillStyle = grad;
                    ctx.beginPath();
                    ctx.arc(x, y, size, 0, Math.PI * 2);
                    ctx.fill();
                }

            } else if (this.vizMode === 'cyber_grid') {
                ctx.fillStyle = '#070612';
                ctx.fillRect(0, 0, this.vizCanvas.width, this.vizCanvas.height);

                const time = Date.now() * 0.0025;
                let bass = 0;
                for (let i = 0; i < 12; i++) bass += dataArray[i];
                const bassPulse = bass / (12 * 255);

                const sunY = cy - 70;
                const sunRadius = 85 + bassPulse * 50; 
                const sunGrad = ctx.createRadialGradient(cx, sunY, 10, cx, sunY, sunRadius);
                sunGrad.addColorStop(0, '#fff066');
                sunGrad.addColorStop(0.3, '#f43f5e');
                sunGrad.addColorStop(0.8, '#8b5cf6');
                sunGrad.addColorStop(1, 'transparent');
                ctx.fillStyle = sunGrad;
                ctx.beginPath();
                ctx.arc(cx, sunY, sunRadius, 0, Math.PI * 2);
                ctx.fill();

                const horizonY = cy - 10;

                // Explicit energetic waveform behind the grid on the horizon
                ctx.beginPath();
                for (let i = 0; i < bufferLength; i++) {
                    const x = (i / bufferLength) * this.vizCanvas.width;
                    const wVal = ((waveData[i] || 128) - 128) / 128.0;
                    const y = horizonY + wVal * 120 * (1 + bassPulse * 2);
                    if (i === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                }
                const waveHue = (time * 80) % 360;
                ctx.strokeStyle = `hsla(${waveHue}, 100%, 60%, ${0.5 + bassPulse * 0.5})`;
                ctx.lineWidth = 4 + bassPulse * 6;
                ctx.stroke();

                const glowGrad = ctx.createLinearGradient(0, horizonY - 10, 0, horizonY + 10);
                glowGrad.addColorStop(0, 'rgba(244, 63, 94, 0)');
                glowGrad.addColorStop(0.5, `rgba(6, 182, 212, ${0.4 + bassPulse * 0.8})`);
                glowGrad.addColorStop(1, 'rgba(244, 63, 94, 0)');
                ctx.fillStyle = glowGrad;
                ctx.fillRect(0, horizonY - 10, this.vizCanvas.width, 20);

                const numCols = 36;
                const numRows = 24;
                const gridSpeed = (time * (40 + bassPulse * 60)) % 1;

                ctx.lineWidth = 1.5 + bassPulse * 2.5;

                for (let r = 0; r < numRows; r++) {
                    const normR = (r + gridSpeed) / numRows;
                    const perspectiveY = horizonY + Math.pow(normR, 2.2) * (this.vizCanvas.height - horizonY);
                    const freqBin = Math.floor(normR * (bufferLength * 0.5));
                    const freqVal = (dataArray[freqBin] || 0) / 255.0;

                    ctx.beginPath();
                    for (let c = 0; c <= numCols; c++) {
                        const normC = c / numCols;
                        const x = (normC - 0.5) * this.vizCanvas.width * (1 + normR * 2.5) + cx;

                        const waveIdx = Math.floor(normC * (bufferLength - 1));
                        const waveVal = ((waveData[waveIdx] || 128) - 128) / 128.0;

                        // Massively amplified displacement based on waveform and frequency
                        const flexDisplacement = waveVal * 100 * normR * (1 + bassPulse * 3) 
                                               + Math.sin(normC * Math.PI * 6 + time * 10) * freqVal * 60 * normR;

                        const y = perspectiveY + flexDisplacement;

                        if (c === 0) ctx.moveTo(x, y);
                        else ctx.lineTo(x, y);
                    }

                    // More colorful, dynamically shifting hues
                    const hue = (time * 40 + normR * 250 + bassPulse * 100) % 360;
                    const alpha = Math.min(1, normR * 1.5);
                    ctx.strokeStyle = `hsla(${hue}, 100%, ${50 + bassPulse * 20}%, ${alpha})`;
                    ctx.stroke();
                }

                for (let c = 0; c <= numCols; c++) {
                    const normC = c / numCols;
                    const waveIdx = Math.floor(normC * (bufferLength - 1));
                    const waveVal = ((waveData[waveIdx] || 128) - 128) / 128.0;

                    ctx.beginPath();
                    for (let r = 0; r <= numRows; r++) {
                        const normR = r / numRows;
                        const perspectiveY = horizonY + Math.pow(normR, 2.2) * (this.vizCanvas.height - horizonY);
                        const x = (normC - 0.5) * this.vizCanvas.width * (1 + normR * 2.5) + cx;

                        const freqBin = Math.floor(normR * (bufferLength * 0.5));
                        const freqVal = (dataArray[freqBin] || 0) / 255.0;

                        const flexDisplacement = waveVal * 100 * normR * (1 + bassPulse * 3)
                                               + Math.sin(normC * Math.PI * 6 + time * 10) * freqVal * 60 * normR;

                        const y = perspectiveY + flexDisplacement;

                        if (r === 0) ctx.moveTo(x, y);
                        else ctx.lineTo(x, y);
                    }

                    const colHue = (320 - normC * 150 + time * 30 + bassPulse * 80) % 360;
                    ctx.strokeStyle = `hsla(${colHue}, 90%, 55%, 0.6)`;
                    ctx.stroke();
                }

            } else if (this.vizMode === 'solar_flare') {
                ctx.fillStyle = 'rgba(5, 5, 12, 0.3)';
                ctx.fillRect(0, 0, this.vizCanvas.width, this.vizCanvas.height);

                const rays = 120;
                const time = Date.now() * 0.001;
                const baseRadius = 100;

                for (let i = 0; i < rays; i++) {
                    const angle = (i / rays) * Math.PI * 2 + time * 0.2;
                    const freqIdx = Math.floor((i / rays) * (bufferLength * 0.7));
                    const val = dataArray[freqIdx] / 255;
                    const len = baseRadius + val * 220;

                    const x2 = cx + Math.cos(angle) * len;
                    const y2 = cy + Math.sin(angle) * len;

                    const hue = (i * 3 + time * 100) % 360;
                    ctx.strokeStyle = `hsla(${hue}, 100%, 60%, ${val + 0.2})`;
                    ctx.lineWidth = 3;
                    ctx.beginPath();
                    ctx.moveTo(cx, cy);
                    ctx.lineTo(x2, y2);
                    ctx.stroke();
                }

            } else if (this.vizMode === 'matrix_rain') {
                ctx.fillStyle = 'rgba(5, 5, 12, 0.2)';
                ctx.fillRect(0, 0, this.vizCanvas.width, this.vizCanvas.height);

                if (!this.matrixDrops) {
                    const cols = Math.floor(this.vizCanvas.width / 20);
                    this.matrixDrops = Array(cols).fill(0);
                }

                let avgVal = 0;
                for (let i = 0; i < bufferLength; i++) avgVal += dataArray[i];
                avgVal /= bufferLength;

                ctx.fillStyle = '#06b6d4';
                ctx.font = '16px monospace';

                for (let i = 0; i < this.matrixDrops.length; i++) {
                    const char = String.fromCharCode(0x30A0 + Math.floor(Math.random() * 96));
                    const x = i * 20;
                    const y = this.matrixDrops[i] * 20;

                    const audioIdx = i % bufferLength;
                    const speed = (dataArray[audioIdx] / 255) * 12 + 4;

                    ctx.fillText(char, x, y);

                    if (y > this.vizCanvas.height || Math.random() > 0.975) {
                        this.matrixDrops[i] = 0;
                    }
                    this.matrixDrops[i] += speed * 0.08;
                }
            }
        };
        draw();
    }

    formatTime(sec) {
        if (isNaN(sec)) return '0:00';
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    }

    formatDate(timestamp) {
        if (!timestamp) return '—';
        const d = new Date(timestamp * 1000);
        return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    }

    escape(str) {
        return str ? String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
    }
}

document.addEventListener('DOMContentLoaded', () => { window.app = new MusicApp(); });
