// import 
import { OpenFileDialog } from '../../wailsjs/go/main/App.js';

// State
let currentAudioFile = null;
let pendingFiles = [];
let medias = [];
// DOM Elements
const dragOverlay = document.getElementById('drag-overlay');
const fileInput = document.getElementById('file-input');
const lyricsInput = document.getElementById('lyrics-input');
const modalAsk = document.getElementById('modal-lyrics-ask');
const mediaContainer = document.getElementById('media-container');
const emptyOverlay = document.getElementById("empty-state");
const fileBtn = document.getElementById("openFileBtn");

// onload 
document.addEventListener("DOMContentLoaded", function () {
    // pre-load
    medias = [];
    // Check if medias were empty
    if (medias.length === 0) {
        emptyOverlay.classList.add('active');
    }
})

// 1. Trigger File Selection (Button Click)
async function triggerFileSelect() {
    let _thisfileName = await OpenFileDialog();
    
}

// 2. Drag and Drop Events (Image 2 Logic)
document.body.addEventListener('dragover', (e) => {
    e.preventDefault();
    dragOverlay.classList.add('active');
});

document.body.addEventListener('dragleave', (e) => {
    // Only hide if we are leaving the window, not just entering a child element
    if (e.relatedTarget === null) {
        dragOverlay.classList.remove('active');
    }
});

document.body.addEventListener('drop', (e) => {
    e.preventDefault();
    dragOverlay.classList.remove('active');

    const files = e.dataTransfer.files;
    if (files.length > 0) {
        processAudioFile(files[0]);
    }
});

// HandleFileSelectBtn
fileBtn.addEventListener("onclick", triggerFileSelect)
// Handle Input Change
fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        processAudioFile(e.target.files[0]);
    }
});

// 3. Core Logic: Process Audio File
function processAudioFile(file) {
    currentAudioFile = file;
    // Show Modal 1
    modalAsk.style.display = 'flex';
}

// 4. Handle Lyrics Choice (The specific requirement)
function handleLyricsChoice(useLyrics) {
    modalAsk.style.display = 'none';

    if (!useLyrics) {
        // Branch A: Do not use lyrics
        addMedia(currentAudioFile, null);
    } else {
        // Branch B: Use lyrics -> Trigger lyrics file picker
        lyricsInput.click();
    }

    // Reset input so same file can be selected again if needed
    fileInput.value = '';
}

// 5. Handle Lyrics File Selection
lyricsInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        const lyricsFile = e.target.files[0];
        // Record paths (simulated) and add to UI
        addMedia(currentAudioFile, lyricsFile);
    } else {
        // User cancelled lyrics selection, treat as no lyrics
        addMedia(currentAudioFile, null);
    }
    lyricsInput.value = '';
});

// 6. Add to UI
function addMedia(audioFile, lyricsFile) {
    const card = document.createElement('div');
    card.className = 'media-card';

    // Simulate path recording
    const audioPath = audioFile.name;
    const lyricsPath = lyricsFile ? lyricsFile.name : 'No Lyrics';

    card.innerHTML = `
                <div class="card-icon">
                    <svg viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
                </div>
                <div class="card-title">${audioPath}</div>
                <div class="card-meta" style="font-size: 0.7rem; color: #1db954;">
                    Lyrics: ${lyricsPath}
                </div>
            `;

    // Insert at the beginning
    mediaContainer.insertBefore(card, mediaContainer.firstChild);
    // build msc 
    medias.push(audioPath)
}

