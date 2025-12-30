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
function init() {
    loadSettings();
    
    // Register settings in Extensions menu
    // Note: SillyTavern usually looks for a specific function or DOM structure
    // Since we don't have the full specific Extension API typings, we'll use a standard approach
    // We attach the settings HTML to the extension panel when it's opened.
    
    // Add event listener for message received
    eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
    
    // Log init
    console.log("[Moe Atelier] Extension loaded");
}

// UI Handling for Settings
// This function is often called by SillyTavern when the extension settings are opened
// Check if we need to export it or attach it to window.
// Based on typical ST extensions, simply exposing an object in the global scope or
// registering via a known API is common. For this simplified version, we rely on 
// standard loading mechanisms.

// Actually, to hook into the UI settings, ST extensions typically use jQuery to append to the drawer
// or use a structured setting definition. Assuming modern ST extension structure:

jQuery(async () => {
    // Wait for ST to load
    init();

    // Hook settings button
    // This part depends heavily on ST version. 
    // We'll expose a global object for debug/access
    window.moeAtelier = {
        settings,
        generateImage
    };
    
    // Inject Settings UI into the DOM when appropriate
    // Ideally we would add a button to the Extensions menu
    const extensionMenu = $("#extensions_settings");
    if (extensionMenu.length) {
        // Create a container for our settings if it doesn't exist
        // Note: For a proper implementation, we should use the `slash_commands` or standard UI hooks
        // But for now, let's assume the user can edit config.json or we inject into the Extension drawer
        
        // Simple watcher to inject settings when the drawer is opened
        const observer = new MutationObserver((mutations) => {
            if (document.getElementById("moe-atelier-settings-container")) return;
            
            const extensionsContent = document.getElementById("extensions_settings");
            if (extensionsContent && extensionsContent.style.display !== "none") {
                const container = document.createElement("div");
                container.id = "moe-atelier-settings-container";
                container.innerHTML = settingsHtml;
                extensionsContent.appendChild(container);
                
                // Bind inputs
                const enabledInput = document.getElementById("moe_enabled");
                const urlInput = document.getElementById("moe_api_url");
                const keyInput = document.getElementById("moe_api_key");
                const modelInput = document.getElementById("moe_model");
                const tagsInput = document.getElementById("moe_common_tags");
                
                if(enabledInput) {
                    enabledInput.checked = settings.enabled;
                    enabledInput.addEventListener("change", (e) => {
                        settings.enabled = e.target.checked;
                        saveSettings();
                    });
                }
                
                if(urlInput) {
                    urlInput.value = settings.apiUrl;
                    urlInput.addEventListener("change", (e) => {
                        settings.apiUrl = e.target.value;
                        saveSettings();
                    });
                }
                
                if(keyInput) {
                    keyInput.value = settings.apiKey;
                    keyInput.addEventListener("change", (e) => {
                        settings.apiKey = e.target.value;
                        saveSettings();
                    });
                }
                
                if(modelInput) {
                    modelInput.value = settings.model;
                    modelInput.addEventListener("change", (e) => {
                        settings.model = e.target.value;
                        saveSettings();
                    });
                }

                if(tagsInput) {
                    tagsInput.value = settings.commonTags;
                    tagsInput.addEventListener("change", (e) => {
                        settings.commonTags = e.target.value;
                        saveSettings();
                    });
                }
            }
        });
        
        observer.observe(document.body, { childList: true, subtree: true });
    }
});
