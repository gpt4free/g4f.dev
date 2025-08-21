// Recorder Class
class Recorder {
    constructor(stream) {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.source = this.audioContext.createMediaStreamSource(stream);;
        this.processor = null;
        this.mediaChunks = [];
        this.wavBlob = null;
    }

    start() {
        this.mediaChunks = []; // Reset stored data
        
        // Create script processor to capture audio buffers
        this.processor = this.source.context.createScriptProcessor(4096, 1, 1);
        
        this.processor.onaudioprocess = (e) => {
            // Convert Float32 audio data to Int16 (WAV uses 16-bit)
            const data = this._floatTo16BitPCM(e.inputBuffer.getChannelData(0));
            this.mediaChunks.push(data);
        };
        
        // Connect nodes
        this.source.connect(this.processor);
        this.processor.connect(this.source.context.destination);
    }

    stop() {
        // Disconnect nodes
        this.processor.disconnect();
        this.source.disconnect();
        
        // Generate WAV header + audio data
        this.wavBlob = this._encodeWAV(this.mediaChunks);
    }

    // Convert Float32 to Int16 (WAV uses 16-bit integers)
    _floatTo16BitPCM(input) {
        const output = new DataView(new ArrayBuffer(input.length * 2));
        for (let i = 0; i < input.length; i++) {
            const s = Math.max(-1, Math.min(1, input[i]));
            output.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        }
        return output;
    }

    // Generate WAV file Blob from PCM data
    _encodeWAV(chunks) {
        // Combine all PCM chunks into a single buffer
        const length = chunks.reduce((acc, chunk) => acc + chunk.byteLength, 0);
        const buffer = new ArrayBuffer(44 + length);
        const view = new DataView(buffer);
        
        // Write WAV header (44 bytes)
        this._writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + length, true); // File length
        this._writeString(view, 8, 'WAVE');
        this._writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true); // Format chunk length
        view.setUint16(20, 1, true); // PCM format
        view.setUint16(22, 1, true); // Mono
        view.setUint32(24, this.audioContext.sampleRate, true);
        view.setUint32(28, this.audioContext.sampleRate * 2, true); // Byte rate
        view.setUint16(32, 2, true); // Block align (2 bytes per sample)
        view.setUint16(34, 16, true); // Bits per sample
        this._writeString(view, 36, 'data');
        view.setUint32(40, length, true); // Data chunk length
        
        // Write PCM data
        let offset = 44;
        chunks.forEach(chunk => {
            new Uint8Array(buffer, offset).set(new Uint8Array(chunk.buffer));
            offset += chunk.byteLength;
        });
        
        return new Blob([view], { type: 'audio/wav' });
    }

    _writeString(view, offset, string) {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    }
}