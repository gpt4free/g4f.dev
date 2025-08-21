## G4F - Media Documentation

This document outlines how to use the G4F (Generative Framework) library to generate and process various media types, including audio, images, and videos.

---

### 1. **Audio Generation and Transcription**

G4F supports audio generation through providers like PollinationsAI, OpenAIFM, and others, as well as audio transcription using providers like Microsoft_Phi_4_Multimodal.

#### **Generate Audio with PollinationsAI:**

```python
import asyncio
from g4f.client import AsyncClient
import g4f.Provider

async def main():
    client = AsyncClient(provider=g4f.Provider.PollinationsAI)

    response = await client.chat.completions.create(
        model="openai-audio",
        messages=[{"role": "user", "content": "Say good day to the world"}],
        audio={"voice": "alloy", "format": "mp3"},
    )
    response.choices[0].message.save("alloy.mp3")

asyncio.run(main())
```

<details>
<summary>Generate Audio with OpenAIFM:</summary>

OpenAIFM provides high-quality text-to-speech with various voice options and customizable voice styles.

```python
from g4f.client import Client
import g4f.Provider as Provider

# Initialize client with OpenAIFM provider
client = Client(provider=Provider.OpenAIFM)

# Generate audio with default settings
response = client.media.generate(
    "Hello, this is a test message for text-to-speech conversion.",
    model="gpt-4o-mini-tts",
    audio={"voice": "coral"}
)

# Save the generated audio
response.data[0].save("openai_fm_audio.mp3")
```
</details>

<details>
<summary>Available Voices in OpenAIFM:</summary>

OpenAIFM supports multiple voice options:
- alloy
- ash
- ballad
- coral (default)
- echo
- fable
- onyx
- nova
- sage
- shimmer
- verse
</details>

<details>
<summary>Using Predefined Voice Styles in OpenAIFM:</summary>

OpenAIFM provides several predefined voice styles that can be accessed as class attributes. These styles define the personality, tone, and delivery characteristics of the generated speech:

```python
from g4f.client import Client
import g4f.Provider as Provider

client = Client(provider=Provider.OpenAIFM)

# Available predefined styles as class attributes
# Provider.OpenAIFM.friendly - Default friendly style
# Provider.OpenAIFM.patient_teacher - Educational, patient tone
# Provider.OpenAIFM.noir_detective - Mysterious detective style
# Provider.OpenAIFM.cowboy - Relaxed western drawl
# Provider.OpenAIFM.calm - Reassuring, composed tone
# Provider.OpenAIFM.scientific_style - Formal academic style

# Using the noir_detective style
response = client.media.generate(
    "It appears the package was delivered to the wrong address. We need to find it.",
    model="gpt-4o-mini-tts",
    audio={
        "voice": "onyx",
        "instructions": Provider.OpenAIFM.noir_detective
    }
)

response.data[0].save("detective_style.mp3")
```

Here's a description of each predefined style:

1. **friendly** (default): Cheerful, clear, and reassuring tone that creates a calm atmosphere.
2. **patient_teacher**: Warm, refined, and gently instructive tone like a friendly art instructor.
3. **noir_detective**: Cool, detached, mysterious tone with dramatic pauses to build suspense.
4. **cowboy**: Warm, relaxed, and friendly tone with a steady cowboy drawl.
5. **calm**: Composed, reassuring tone with quiet authority and confidence.
6. **scientific_style**: Authoritative and precise academic tone for technical content.
</details>


<details>
<summary>Creating Custom Voice Instructions in OpenAIFM:</summary>

You can create your own voice style by defining custom instructions as a multi-line string. The instructions should describe the voice characteristics, tone, pacing, emotion, pronunciation, and pauses:

```python
from g4f.client import Client
import g4f.Provider as Provider

client = Client(provider=Provider.OpenAIFM)

# Custom voice style
custom_instructions = """
Voice: Energetic and enthusiastic, with a youthful quality.

Tone: Upbeat and positive, conveying excitement and passion about the topic.

Pacing: Quick but clear, with dynamic variations to maintain interest.

Emotion: Genuinely excited and enthusiastic, with occasional moments of awe or surprise.

Pronunciation: Crisp and clear, with emphasis on key words to highlight important points.

Pauses: Strategic short pauses before important information, creating anticipation.
"""

response = client.media.generate(
    "This is amazing news! We're launching a new product that will change the industry!",
    model="gpt-4o-mini-tts",
    audio={
        "voice": "nova",
        "instructions": custom_instructions
    }
)

response.data[0].save("custom_enthusiastic_style.mp3")
```

##### **Structure for Custom Voice Instructions:**

When creating custom instructions, consider including these elements:

1. **Voice/Affect**: The overall personality or character of the voice.
2. **Tone**: The emotional quality and attitude of the speech.
3. **Pacing**: The speed and rhythm of speech delivery.
4. **Emotion**: The specific feelings to convey in the speech.
5. **Pronunciation**: How words should be articulated.
6. **Pauses**: Where and how long to pause between phrases.

This structure helps the model understand exactly how to style the generated speech.
</details>

<details>
<summary>Full example for JavaScript</summary>

```javascript
async function generateSpeech(text) {
    const url = '/v1/audio/speech'; // Replace with actual API URL
    const requestData = {
        input: text,
        voice: '', // Adjust voice settings as needed
        response_format: 'mp3' // Adjust format settings
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestData)
        });

        if (!response.ok) {
            throw new Error(`API error: ${response.status} ${response.statusText}`);
        }

        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        const audioElement = new Audio(audioUrl);
        audioElement.play();
    } catch (error) {
        console.error('Error generating speech audio:', error);
    }
}

// Example usage
generateSpeech('Hello, this is a speech synthesis test.');
```
</details>

<details>
<summary>Examples for all providers</summary>

```python
from g4f.client import Client

from g4f.Provider import gTTS, EdgeTTS, Gemini, PollinationsAI, OpenAIFM

# OpenAIFM
client = Client(provider=OpenAIFM)
response = client.media.generate(
    "Hello",
    model="gpt-4o-mini-tts",
    audio={"voice": "coral"}
)
response.data[0].save("openai_fm.mp3")

# PollinationsAI
client = Client(provider=PollinationsAI)
response = client.media.generate("Hello", audio={"voice": "alloy", "format": "mp3"})
response.data[0].save("openai.mp3")

client = Client(provider=PollinationsAI)
response = client.media.generate("Hello", model="hypnosis-tracy")
response.data[0].save("hypnosis.mp3")

client = Client(provider=Gemini)
response = client.media.generate("Hello", model="gemini-audio")
response.data[0].save("gemini.ogx")

client = Client(provider=EdgeTTS)
response = client.media.generate("Hello", audio={"language": "en"})
response.data[0].save("edge-tts.mp3")

# The EdgeTTS provider also support the audio parameters `rate`, `volume` and `pitch`

client = Client(provider=gTTS)
response = client.media.generate("Hello", audio={"language": "en-US"})
response.data[0].save("google-tts.mp3")

# The gTTS provider also support the audio parameters `tld` and `slow`
```
</details>

#### **Transcribe an Audio File:**

Some providers in G4F support audio inputs in chat completions, allowing you to transcribe audio files by instructing the model accordingly. This example demonstrates how to use the `AsyncClient` to transcribe an audio file asynchronously:

```python
import asyncio
from g4f.client import AsyncClient
import g4f.Provider

async def main():
    client = AsyncClient(provider=g4f.Provider.Microsoft_Phi_4_Multimodal)

    with open("audio.wav", "rb") as audio_file:
        response = await client.chat.completions.create(
            messages="Transcribe this audio",
            media=[[audio_file, "audio.wav"]],
            modalities=["text"],
        )

    print(response.choices[0].message.content)

if __name__ == "__main__":
    asyncio.run(main())
```

#### Explanation
- **Client Initialization**: An `AsyncClient` instance is created with a provider that supports audio inputs, such as `PollinationsAI` or `Microsoft_Phi_4_Multimodal`.
- **File Handling**: The audio file (`audio.wav`) is opened in binary read mode (`"rb"`) using a context manager (`with` statement) to ensure proper file closure after use.
- **API Call**: The `chat.completions.create` method is called with:
  - `messages`: Containing a user message instructing the model to transcribe the audio.
  - `media`: A list of lists, where each inner list contains the file object and its name (`[[audio_file, "audio.wav"]]`).
  - `modalities=["text"]`: Specifies that the output should be text (the transcription).
- **Response**: The transcription is extracted from `response.choices[0].message.content` and printed.

#### Notes
- **Provider Support**: Ensure the chosen provider (e.g., `PollinationsAI` or `Microsoft_Phi_4_Multimodal`) supports audio inputs in chat completions. Not all providers may offer this functionality.
- **File Path**: Replace `"audio.wav"` with the path to your own audio file. The file format (e.g., WAV) should be compatible with the provider.
- **Model Selection**: If `g4f.models.default` does not support audio transcription, you may need to specify a model that does (consult the provider's documentation for supported models).

This example complements the guide by showcasing how to handle audio inputs asynchronously, expanding on the multimodal capabilities of the G4F AsyncClient API.

#### **More examples for Transcription:**

<details>
<summary>JavaScript</summary>

```javascript
const endpoint = "/v1/audio/transcriptions";
const formData = new FormData();

formData.append("file", audioFile);
formData.append("model", "");

try {
    const response = await fetch(endpoint, {
        method: "POST",
        body: formData,
    });
    if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
    }
    const result = await response.json();
    console.log("Transcribed text:", result.text);
} catch (error) {
    console.error("Transcription error:", error);
    return null;
}
```
</details>

<details>
<summary>JavaScript with MediaRecorder</summary>

Required:
```
pip install markitdown[audio-transcription]
```
```
apt-get install ffmpeg flac
```
Optional:
```
pip install faster_whisper soundfile
```
Full example:
```javascript
let mediaRecorder;

audioButton.addEventListener('click', async (event) => {
    if (mediaRecorder) {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
        mediaRecorder = null;
        return;
    }

    stream = await navigator.mediaDevices.getUserMedia({
        audio: true
    })

    if (!MediaRecorder.isTypeSupported('audio/webm')) {
        console.warn('audio/webm is not supported');
    }

    mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm',
    });

    mediaRecorder.addEventListener('dataavailable', async event => {
        const formData = new FormData();
        formData.append('files', event.data);
        const bucketId = crypto.randomUUID();
        const language = document.getElementById("recognition-language")?.value;
        const response = await fetch("/backend-api/v2/files/" + bucketId, {
            method: 'POST',
            body: formData,
            headers: {
                "x-recognition-language": language,
            }
        });
        const result = await response.json()
        if (result.media) {
            const media = [];
            result.media.forEach((part)=> {
                // Handle result
                const url = `/files/${bucketId}/media/${part.name}`;
                console.log(url);
            });
        }
    });

    mediaRecorder.start()
})
```
</details>

<details>
<summary>Python and requests</summary>

```python
import requests

with open('audio.wav', 'rb') as audio_file:
    response = requests.post('http://localhost:8080/api/markitdown', files={'file': audio_file})
    if response.status_code == 200:
        data = response.json()
        print(data['text'])
    else:
        print(f"Error: {response.status_code}, {response.text}")
```
</details>

<details>
<summary>Python and openai</summary>

```python
from openai import OpenAI

client = OpenAI(base_url="http://localhost:8080/v1", api_key="secret")

with open("audio.wav", "rb") as file:
    transcript = client.audio.transcriptions.create(
        model="",
        extra_body={"provider": "MarkItDown"},
        file=file
    )
print(transcript.text)
```
</details>

---

### 2. **Image Generation**

G4F can generate images from text prompts and provides options to retrieve images as URLs or base64-encoded strings.

#### **Generate an Image:**

```python
import asyncio
from g4f.client import AsyncClient

async def main():
    client = AsyncClient()

    response = await client.images.generate(
        prompt="a white siamese cat",
        model="flux",
        response_format="url",
    )

    image_url = response.data[0].url
    print(f"Generated image URL: {image_url}")

asyncio.run(main())
```

#### **Base64 Response Format:**

```python
import asyncio
from g4f.client import AsyncClient

async def main():
    client = AsyncClient()

    response = await client.images.generate(
        prompt="a white siamese cat",
        model="flux",
        response_format="b64_json",
    )

    base64_text = response.data[0].b64_json
    print(base64_text)

asyncio.run(main())
```

#### **Image Parameters:**
- **`width`**: Defines the width of the generated image.
- **`height`**: Defines the height of the generated image.
- **`n`**: Specifies the number of images to generate.
- **`response_format`**: Specifies the format of the response:
  - `"url"`: Returns the URL of the image.
  - `"b64_json"`: Returns the image as a base64-encoded JSON string.
  - (Default): Saves the image locally and returns a local url.

#### **Example with Image Parameters:**

```python
import asyncio
from g4f.client import AsyncClient

async def main():
    client = AsyncClient()

    response = await client.images.generate(
        prompt="a white siamese cat",
        model="flux",
        response_format="url",
        width=512,
        height=512,
        n=2,
    )

    for image in response.data:
        print(f"Generated image URL: {image.url}")

asyncio.run(main())
```

---

### 3. **Creating Image Variations**

You can generate variations of an existing image using G4F.

#### **Create Image Variations:**

```python
import asyncio
from g4f.client import AsyncClient
from g4f.Provider import OpenaiChat

async def main():
    client = AsyncClient(image_provider=OpenaiChat)

    response = await client.images.create_variation(
        image=open("docs/images/cat.jpg", "rb"),
        model="dall-e-3",
    )

    image_url = response.data[0].url
    print(f"Generated image URL: {image_url}")

asyncio.run(main())
```

---

### 4. **Video Generation**

G4F supports video generation through providers like HuggingFaceMedia.

#### **Generate a Video:**

```python
import asyncio
from g4f.client import AsyncClient
from g4f.Provider import HuggingFaceMedia

async def main():
    client = AsyncClient(
        provider=HuggingFaceMedia,
        api_key=os.getenv("HF_TOKEN") # Your API key here
    )

    video_models = client.models.get_video()
    print("Available Video Models:", video_models)

    result = await client.media.generate(
        model=video_models[0],
        prompt="G4F AI technology is the best in the world.",
        response_format="url",
    )

    print("Generated Video URL:", result.data[0].url)

asyncio.run(main())
```

#### **Video Parameters:**
- **`resolution`**: Specifies the resolution of the generated video. Options include:
  - `"480p"` (default)
  - `"720p"`
- **`aspect_ratio`**: Defines the width-to-height ratio (e.g., `"16:9"`).
- **`n`**: Specifies the number of videos to generate.
- **`response_format`**: Specifies the format of the response:
  - `"url"`: Returns the URL of the video.
  - `"b64_json"`: Returns the video as a base64-encoded JSON string.
  - (Default): Saves the video locally and returns a local url.

#### **Example with Video Parameters:**

```python
import os
import asyncio
from g4f.client import AsyncClient
from g4f.Provider import HuggingFaceMedia

async def main():
    client = AsyncClient(
        provider=HuggingFaceMedia,
        api_key=os.getenv("HF_TOKEN")  # Your API key here
    )

    video_models = client.models.get_video()
    print("Available Video Models:", video_models)

    result = await client.media.generate(
        model=video_models[0],
        prompt="G4F AI technology is the best in the world.",
        resolution="720p",
        aspect_ratio="16:9",
        n=1,
        response_format="url",
    )

    print("Generated Video URL:", result.data[0].url)

asyncio.run(main())
```

---

**Key Points:**

- **Provider Selection**: Ensure the selected provider supports the desired media generation or processing task.
- **API Keys**: Some providers require API keys for authentication.
- **Response Formats**: Use `response_format` to control the output format (URL, base64, local file).
- **Parameter Usage**: Use parameters like `width`, `height`, `resolution`, `aspect_ratio`, and `n` to customize the generated media.

---

[Return to Documentation](README.md)
