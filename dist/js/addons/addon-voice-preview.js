/* ================================================================== *
 * Addon: Voice models & preview                                      *
 *                                                                    *
 * Extracted from chat.v1.js lines 346-420. Loads the available       *
 * TTS voices from the g4f.space audio API and plays previews.        *
 * ================================================================== */

(function () {
    'use strict';

    ChatAddons.register({
        id: 'builtin:voice-preview',
        name: 'Voice Models & Preview',
        version: '1.0.0',
        description: 'Loads TTS voice options and plays audio previews of the selected voice.',
        author: 'g4f',
        builtin: true,
        permissions: ['net:fetch'],

        load() {                        
            // Load voice models for the voice select dropdown
            window.loadVoiceModels();
        }
    });
})();

window.voicePreviewAudio = null;

window.loadVoiceModels = async function loadVoiceModels() {
    const voiceSelect = document.getElementById('voice');
    if (!voiceSelect) return;

    try {
        const response = await fetch('https://g4f.space/api/audio/models');
        if (!response.ok) {
            throw new Error('Failed to fetch voice models');
        }
        const data = await response.json();

        // Clear existing options
        voiceSelect.innerHTML = '';

        // Populate with voice models
        if (data.data && Array.isArray(data.data)) {
            data.data.forEach(voice => {
                const option = document.createElement('option');
                option.selected = voice.id === 'gpt-audio';
                option.value = voice.id === 'gpt-audio' ? '' : voice.id;
                option.textContent = voice.id === 'gpt-audio' ? 'Default (gemini)' : voice.name || voice.id;
                voiceSelect.appendChild(option);
            });
        } else if (Array.isArray(data)) {
            data.forEach(voice => {
                const option = document.createElement('option');
                option.value = typeof voice === 'string' ? voice : voice.name || voice.id;
                option.textContent = typeof voice === 'string' ? voice : voice.name || voice.id;
                voiceSelect.appendChild(option);
            });
        }

        // Restore saved voice selection
        const savedVoice = window.appStorage?.getItem('voice');
        if (savedVoice) {
            voiceSelect.value = savedVoice;
        }

        // Add change event listener to play preview and save selection
        voiceSelect.addEventListener('change', async (event) => {
            const selectedVoice = event.target.value;
            window.appStorage?.setItem('voice', selectedVoice);

            if (selectedVoice) {
                window.playVoicePreview(selectedVoice);
            }
        });
    } catch (error) {
        console.error('Error loading voice models:', error);
        voiceSelect.innerHTML = '<option value="">Failed to load voices</option>';
    }
};

window.playVoicePreview = async function playVoicePreview(voice) {
    // Stop any currently playing preview
    if (window.voicePreviewAudio) {
        window.voicePreviewAudio.pause();
        window.voicePreviewAudio = null;
    }

    const previewText = 'Hello, how are you?';
    const audioUrl = `https://g4f.space/ai/audio/${encodeURIComponent(previewText)}?voice=${encodeURIComponent(voice)}`;
    const response = await fetch(audioUrl, {
        headers: window.appStorage?.getItem('g4f_session') ? {
            'Authorization': `Bearer ${window.appStorage.getItem('g4f_session')}`
        } : {}
    });
    const object = await response.blob();
    window.voicePreviewAudio = new Audio(URL.createObjectURL(object));
    window.voicePreviewAudio.play().catch(error => {
        console.error('Error playing voice preview:', error);
    });
};