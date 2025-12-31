// Moe Atelier Extension - Zero Dependency Version
const extensionName = "moe-atelier";
const defaultSettings = {
    apiUrl: "https://ruoyun.icu/v1",
    apiKey: "sk-VJogWtM15QFkvMWMMU4N82QnrTjdguXKIYQHKuPyUCGtxAfS",
    model: "gemini-3-pro-image-preview",
    enabled: true,
    commonTags: "masterpiece, best quality"
};

let settings = defaultSettings;

// Helper to find globals
function getSTGlobal(name) {
    if (window[name]) return window[name];
    if (window.SillyTavern && window.SillyTavern[name]) return window.SillyTavern[name];
    return null;
}

// Helpers normally imported
function getContext() {
    const ctx = getSTGlobal('getContext');
    return ctx ? ctx() : null;
}

function getExtensionSettings(name) {
    const fn = getSTGlobal('getExtensionSettings');
    return fn ? fn(name) : {};
}

function saveSettingsDebounced() {
    const fn = getSTGlobal('saveSettingsDebounced');
    if (fn) fn();
}

const eventSource = getSTGlobal('eventSource');
const event_types = getSTGlobal('event_types') || {
    MESSAGE_RECEIVED: 'MESSAGE_RECEIVED',
    MESSAGE_UPDATED: 'MESSAGE_UPDATED'
};

// Load settings
function loadSettings() {
    const saved = getExtensionSettings(extensionName);
    settings = Object.assign({}, defaultSettings, saved);
}

// Save settings
function saveSettings() {
    const context = getContext();
    if (context) {
        context.extensionSettings[extensionName] = settings;
        saveSettingsDebounced();
    }
}

// Handler for incoming messages
async function onMessageReceived(messageId) {
    if (!settings.enabled) return;

    const context = getContext();
    if (!context) return;
    const chat = context.chat;

    if (!chat || !chat[messageId]) return;

    const message = chat[messageId];
    if (message.is_user) return;

    // Verbose logging for debugging
    console.log(`[Moe Atelier] Inspecting message ${messageId}:`, message.mes);

    // Flexible Regex:
    // 1. Matches <!-- with optional spaces
    // 2. Matches img-prompt with optional spaces/equals
    // 3. Captures content inside "..." or '...'
    const promptRegex = /<!--\s*img-prompt\s*=\s*(["'])(.*?)\1\s*-->/g;

    // transform iterator to array
    const matches = [...message.mes.matchAll(promptRegex)];

    if (matches.length === 0) {
        console.log("[Moe Atelier] No image tags found in this message.");
        return;
    }

    console.log(`[Moe Atelier] Found ${matches.length} image prompts.`);
    if (window.toastr) window.toastr.info(`Found ${matches.length} image prompt(s). Generating...`, "Moe Atelier");

    let updatedMessage = message.mes;
    let modified = false;

    for (const match of matches) {
        const fullTag = match[0];
        const quoteType = match[1]; // " or '
        const prompt = match[2];    // The actual prompt text

        if (updatedMessage.indexOf(fullTag) === -1) continue;

        const imageUrl = await generateImage(prompt);
        if (imageUrl) {
            // Use Markdown syntax for robustness
            const imgTag = `\n\n![${prompt}](${imageUrl})\n`;
            updatedMessage = updatedMessage.replace(fullTag, imgTag);
            modified = true;
        }
    }

    if (modified) {
        chat[messageId].mes = updatedMessage;
        if (eventSource) eventSource.emit(event_types.MESSAGE_UPDATED, messageId);
        context.saveChat();
    }
}

// Helper to clean URL
function sanitizeUrl(url) {
    return url.replace(/\/$/, ""); // Remove trailing slash
}

// Generate Image
async function generateImage(prompt) {
    console.log(`[Moe Atelier] Generating image for prompt: ${prompt}`);
    const fullPrompt = settings.commonTags ? `${prompt}, ${settings.commonTags}` : prompt;

    const baseUrl = sanitizeUrl(settings.apiUrl);
    const endpoint = `${baseUrl}/chat/completions`;

    console.log(`[Moe Atelier] Requesting: ${endpoint}`);

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${settings.apiKey}`
            },
            body: JSON.stringify({
                model: settings.model,
                messages: [{ role: "user", content: fullPrompt }],
                stream: false
            })
        });

        // Read text first to debug non-JSON responses
        const textResponse = await response.text();

        if (!response.ok) {
            console.error('[Moe Atelier] API Error Body:', textResponse);
            throw new Error(`API Error (${response.status}): ${textResponse.substring(0, 100)}`);
        }

        let data;
        try {
            data = JSON.parse(textResponse);
        } catch (e) {
            console.error('[Moe Atelier] JSON Parse Error. Request:', endpoint);
            console.error('[Moe Atelier] Response Body:', textResponse);
            throw new Error(`Invalid JSON from API: ${textResponse.substring(0, 50)}...`);
        }

        // Extract Image
        let imageUrl = null;
        if (data.data && data.data[0] && data.data[0].url) imageUrl = data.data[0].url;
        else if (data.data && data.data[0] && data.data[0].b64_json) imageUrl = `data:image/png;base64,${data.data[0].b64_json}`;
        else if (data.choices && data.choices[0] && data.choices[0].message) {
            const content = data.choices[0].message.content;
            const match = content.match(/!\[.*?\]\((.*?)\)/);
            if (match && match[1]) imageUrl = match[1];
            else if (content.startsWith('http') || content.startsWith('data:image')) imageUrl = content;
        }

        if (!imageUrl) {
            console.warn('[Moe Atelier] No image found in response:', data);
            throw new Error('No image found in API response');
        }
        return imageUrl;

    } catch (error) {
        console.error('[Moe Atelier] Image generation failed:', error);
        if (window.toastr) window.toastr.error(`Error: ${error.message}`, "Moe Atelier Error");
        return null;
    }
}

// Settings HTML
const settingsHtml = `
<div class="moe-atelier-settings">
    <h3>Moe Atelier Settings</h3>
    <div class="moe-atelier-setting-item"><label>Enable</label><input type="checkbox" id="moe_enabled" /></div>
    <div class="moe-atelier-setting-item">
        <label>API URL <small>(e.g. https://ruoyun.icu/v1)</small></label>
        <input type="text" id="moe_api_url" />
    </div>
    <div class="moe-atelier-setting-item"><label>API Key</label><input type="password" id="moe_api_key" /></div>
    <div class="moe-atelier-setting-item"><label>Model</label><input type="text" id="moe_model" /></div>
    <div class="moe-atelier-setting-item"><label>Tags</label><input type="text" id="moe_common_tags" /></div>
    <div class="moe-atelier-setting-item" style="margin-top:15px; border-top: 1px solid rgba(255,255,255,0.2); paddingTop: 10px;">
        <button id="moe_test_btn" class="menu_button">Test Connection & Generate</button>
    </div>
</div>`;

// UI Logic
function toggleSettings(show) {
    const overlay = document.getElementById('moe-settings-overlay');
    if (overlay) {
        const isHidden = overlay.style.display === 'none';
        overlay.style.display = (show === undefined ? isHidden : show) ? 'flex' : 'none';
    }
}

function injectFloatingUI() {
    $("#moe-floating-btn").remove();
    $("#moe-settings-overlay").remove();

    const btn = $(`<div id="moe-floating-btn" title="Moe Atelier">🎨</div>`);
    btn.on('click', () => toggleSettings());
    $('body').append(btn);

    const overlay = $(`<div id="moe-settings-overlay" style="display:none"><div id="moe-settings-modal"><div id="moe-settings-close">&times;</div>${settingsHtml}</div></div>`);

    // Wire up events
    overlay.find('#moe-settings-close').on('click', () => toggleSettings(false));
    overlay.on('click', (e) => { if (e.target.id === 'moe-settings-overlay') toggleSettings(false); });

    // Test Button
    overlay.find('#moe_test_btn').on('click', async function () {
        const btn = $(this);
        const originalText = btn.text();
        btn.text("Testing...").prop('disabled', true);

        try {
            if (window.toastr) window.toastr.info("Sending test request...", "Moe Atelier");
            const url = await generateImage("cute anime girl chibi test");
            if (url) {
                if (window.toastr) window.toastr.success("Test Successful! Opening image...", "Moe Atelier");
                window.open(url, '_blank');
            }
            // Error handled in generateImage
        } catch (e) {
            // Should be caught in generateImage, but just in case
            alert("Unexpected Error: " + e.message);
        } finally {
            btn.text(originalText).prop('disabled', false);
        }
    });

    $('body').append(overlay);

    // Bindings with slight delay
    setTimeout(() => {
        const bind = (id, key) => {
            $(`#${id}`).each(function () {
                if (typeof settings[key] === 'boolean') {
                    this.checked = settings[key];
                    $(this).on('change', function () { settings[key] = this.checked; saveSettings(); });
                } else {
                    this.val = settings[key];
                    this.value = settings[key];
                    $(this).on('change', function () { settings[key] = this.value; saveSettings(); });
                }
            });
        };
        bind("moe_enabled", "enabled");
        bind("moe_api_url", "apiUrl");
        bind("moe_api_key", "apiKey");
        bind("moe_model", "model");
        bind("moe_common_tags", "commonTags");
    }, 500);
}

// Initialization
jQuery(async () => {
    console.log("[Moe Atelier] Initializing Improved Version");

    await new Promise(r => setTimeout(r, 1000));

    loadSettings();
    injectFloatingUI();

    const context = getContext();
    if (context && context.slashCommandParser) {
        context.slashCommandParser.addCommandObject({
            name: 'moe_settings',
            description: 'Open Moe Atelier Settings',
            callback: () => { toggleSettings(true); return "Opened settings."; }
        });
    }

    if (eventSource && event_types) {
        eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
    }

    window.moeAtelier = { settings, generateImage, toggleSettings };
    console.log("[Moe Atelier] Ready!");
});
