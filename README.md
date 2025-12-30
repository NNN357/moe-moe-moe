# Moe Atelier Extension for SillyTavern

This extension integrates your custom image generation API (ruoyun.icu) directly into SillyTavern, allowing for inline image generation without relying on the built-in Stable Diffusion extension.

## Features

- **Direct API Integration**: Connects to `https://ruoyun.icu/v1` (or any OpenAI-compatible endpoint).
- **Inline Images**: Automatically replaces prompt tags with generated images in the chat.
- **Customizable**: Configure API Key, Model, and Common Tags.

## Installation

1. **Locate your SillyTavern Extensions folder**:
   Usually found at `SillyTavern/data/default-user/extensions/`.

2. **Copy the folder**:
   Copy the `moe-atelier-extension` folder to the extensions directory.
   
   Final path should look like: `.../extensions/moe-atelier-extension/index.js`

3. **Enable in SillyTavern**:
   - Restart SillyTavern.
   - Go to **Extensions**.
   - Find **Moe Atelier** in the list and enable it.

## Configuration

1. Open the **Extensions** menu.
2. Scroll to the **Moe Atelier Settings** section (or click the settings gear if available).
3. Verify your API Key (pre-filled with your provided key).
4. Adjust the Model or Common Tags if needed.

## Usage

To generate an image, the LLM (or you) must include a special tag in the message:

```html
<!--img-prompt="your image prompt here"-->
```

### Automation using Author's Note / Character Card

Add this to your Character Card's "Scenario" or "Author's Note" to teach the LLM to generate images:

> [!TIP]
> **Prompt Instruction Example:**
> "If a visual description would enhance the story, include an image prompt tag at the end of your response like this: `<!--img-prompt="detailed description of the scene"-->`."

The extension will detect this tag, generate the image, and replace the tag with the actual image.
