import {
    saveSettingsDebounced,
    event_types,
    eventSource,
    getExtensionSettings,
    getContext,
} from '../../../../script.js';

const extensionName = "moe-atelier";
const defaultSettings = {
    apiUrl: "https://ruoyun.icu/v1",
    apiKey: "sk-VJogWtM15QFkvMWMMU4N82QnrTjdguXKIYQHKuPyUCGtxAfS",
    model: "gemini-3-pro-image-preview",
    enabled: true,
    commonTags: "masterpiece, best quality"
};

let settings = defaultSettings;

// Load settings
function loadSettings() {
    settings = Object.assign({}, defaultSettings, getExtensionSettings(extensionName));
}

// Save settings implementation
function saveSettings() {
    const context = getContext();
    context.extensionSettings[extensionName] = settings;
    saveSettingsDebounced();
}

// Generate image using the custom API
async function generateImage(prompt) {
    console.log(`[Moe Atelier] Generating image for prompt: ${prompt}`);

    // Combine prompt with common tags
    const fullPrompt = settings.commonTags ? `${prompt}, ${settings.commonTags}` : prompt;

    try {
        const response = await fetch(`${settings.apiUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${settings.apiKey}`
            },
            body: JSON.stringify({
                model: settings.model,
                messages: [
                    {
                        role: "user",
                        content: fullPrompt
                    }
                ],
                stream: false
            })
        });

        if (!response.ok) {
            throw new Error(`API Error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        // Extract image URL from various possible response formats
        let imageUrl = null;

        // 1. Check data[0].url (OpenAI image format)
        if (data.data && data.data[0] && data.data[0].url) {
            imageUrl = data.data[0].url;
        }
        // 2. Check data[0].b64_json (OpenAI base64 format)
        else if (data.data && data.data[0] && data.data[0].b64_json) {
            imageUrl = `data:image/png;base64,${data.data[0].b64_json}`;
        }
        // 3. Check message content for markdown image (Chat completion format)
        else if (data.choices && data.choices[0] && data.choices[0].message) {
            const content = data.choices[0].message.content;
            const match = content.match(/!\[.*?\]\((.*?)\)/);
            if (match && match[1]) {
                imageUrl = match[1];
            } else if (content.startsWith('http') || content.startsWith('data:image')) {
                imageUrl = content;
            }
        }

        if (!imageUrl) {
            console.error('[Moe Atelier] Could not extract image from response:', data);
            throw new Error('No image found in API response');
        }

        return imageUrl;

    } catch (error) {
        console.error('[Moe Atelier] Image generation failed:', error);
        toastr.error(`Image generation failed: ${error.message}`, "Moe Atelier");
        return null;
    }
}

// Handler for incoming messages
async function onMessageReceived(messageId) {
    if (!settings.enabled) return;

    const context = getContext();
    const chat = context.chat;

    if (!chat || !chat[messageId]) return;

    const message = chat[messageId];

    // Only process assistant messages or user messages if configured (usually just assistant)
    if (message.is_user) return;

    // Regex to find image prompts: <!--img-prompt="PROMPT"-->
    const promptRegex = /<!--img-prompt="([^"]+)"-->/g;
    const matches = [...message.mes.matchAll(promptRegex)];

    if (matches.length === 0) return;

    console.log(`[Moe Atelier] Found ${matches.length} image prompts in message ${messageId}`);
    toastr.info(`Generating ${matches.length} image(s)...`, "Moe Atelier");

    let updatedMessage = message.mes;
    let modified = false;

    // Process each match
    for (const match of matches) {
        const fullTag = match[0];
        const prompt = match[1];

        // Check if already replaced (in case of re-runs)
        if (updatedMessage.indexOf(fullTag) === -1) continue;

        // Generate image
        // Insert a loading placeholder first? For now, we'll just wait.
        // SillyTavern extensions often modify message content directly.

        const imageUrl = await generateImage(prompt);

        if (imageUrl) {
            const imgTag = `<div class="moe-atelier-image-container"><img src="${imageUrl}" class="moe-atelier-image" alt="${prompt}" title="${prompt}"></div>`;
            updatedMessage = updatedMessage.replace(fullTag, imgTag);
            modified = true;
        }
    }

    if (modified) {
        // Update the message in chat history
        chat[messageId].mes = updatedMessage;

        // Trigger UI update
        // We need to emit MESSAGE_UPDATED to refresh the UI
        eventSource.emit(event_types.MESSAGE_UPDATED, messageId);

        // Save chat
        context.saveChat();
        console.log(`[Moe Atelier] Message ${messageId} updated with images`);
    }
}

// Settings UI HTML
const settingsHtml = `
<div class="moe-atelier-settings">
    <h3>Moe Atelier Settings</h3>
    
    <div class="moe-atelier-setting-item">
        <label for="moe_enabled">Enable Extension</label>
        <input type="checkbox" id="moe_enabled" />
    </div>

    <div class="moe-atelier-setting-item">
        <label for="moe_api_url">API URL</label>
        <input type="text" id="moe_api_url" placeholder="https://api.openai.com/v1" />
    </div>

    <div class="moe-atelier-setting-item">
        <label for="moe_api_key">API Key</label>
        <input type="password" id="moe_api_key" placeholder="sk-..." />
    </div>

    <div class="moe-atelier-setting-item">
        <label for="moe_model">Model Name</label>
        <input type="text" id="moe_model" placeholder="dall-e-3" />
    </div>
    
    <div class="moe-atelier-setting-item">
        <label for="moe_common_tags">Common Tags</label>
        <input type="text" id="moe_common_tags" placeholder="masterpiece, best quality" />
    </div>
</div>
`;

// Initialize extension
async function init() {
    loadSettings();

    // Inject floating UI (fallback for settings menu)
    injectFloatingUI();

    // Also try to inject into standard menu just in case
    injectSettingsUI();

    // Register Slash Command for Settings
    const context = getContext();
    if (context.slashCommandParser) {
        context.slashCommandParser.addCommandObject({
            name: 'moe_settings',
            description: 'Open Moe Atelier Settings',
            callback: (args, value) => {
                toggleSettings(true);
                return "Settings opened.";
            }
        });
    }

    // Add event listener for message received
    eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);

    console.log("[Moe Atelier] Extension loaded with Floating UI");
}

function toggleSettings(show) {
    const overlay = document.getElementById('moe-settings-overlay');
    if (!overlay) return;

    if (show === undefined) {
        // Toggle
        overlay.style.display = overlay.style.display === 'none' ? 'flex' : 'none';
    } else {
        overlay.style.display = show ? 'flex' : 'none';
    }
}

function injectFloatingUI() {
    // Remove existing
    $("#moe-floating-btn").remove();
    $("#moe-settings-overlay").remove();

    // Create Floating Button
    const btn = document.createElement('div');
    btn.id = 'moe-floating-btn';
    btn.innerHTML = '🎨'; // Art palette emoji
    btn.title = 'Moe Atelier Settings';
    btn.onclick = () => toggleSettings();
    document.body.appendChild(btn);

    // Create Modal Overlay
    const overlay = document.createElement('div');
    overlay.id = 'moe-settings-overlay';
    overlay.style.display = 'none';

    const modal = document.createElement('div');
    modal.id = 'moe-settings-modal';

    // Close button
    const closeBtn = document.createElement('div');
    closeBtn.id = 'moe-settings-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.onclick = () => toggleSettings(false);

    modal.appendChild(closeBtn);

    // Content Container
    const content = document.createElement('div');
    content.innerHTML = settingsHtml;
    modal.appendChild(content);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Bind inputs immediately for the modal
    setTimeout(() => {
        const bind = (id, key) => {
            const els = document.querySelectorAll(`#${id}`);
            els.forEach(el => {
                if (typeof settings[key] === 'boolean') {
                    el.checked = settings[key];
                    el.addEventListener("change", (e) => {
                        settings[key] = e.target.checked;
                        saveSettings();
                    });
                } else {
                    el.value = settings[key];
                    el.addEventListener("change", (e) => {
                        settings[key] = e.target.value;
                        saveSettings();
                    });
                }
            });
        };

        bind("moe_enabled", "enabled");
        bind("moe_api_url", "apiUrl");
        bind("moe_api_key", "apiKey");
        bind("moe_model", "model");
        bind("moe_common_tags", "commonTags");
    }, 100);

    // Close on click outside
    overlay.onclick = (e) => {
        if (e.target === overlay) toggleSettings(false);
    };
}

function injectSettingsUI() {
    const extensionMenu = $("#extensions_settings");
    if (extensionMenu.length) {
        $("#moe-atelier-settings-container").remove();
        const container = document.createElement("div");
        container.id = "moe-atelier-settings-container";
        container.innerHTML = settingsHtml;
        extensionMenu.append(container);
    }
}


jQuery(async () => {
    // Wait for ST to load
    await new Promise(resolve => setTimeout(resolve, 1000));
    init();

    window.moeAtelier = {
        settings,
        generateImage,
        toggleSettings
    };

    const observer = new MutationObserver((mutations) => {
        if (!document.getElementById("moe-atelier-settings-container") && $("#extensions_settings").length) {
            injectSettingsUI();
        }
    });

    const target = document.querySelector('#extensions_settings') || document.body;
    observer.observe(target, { childList: true, subtree: true });
});
