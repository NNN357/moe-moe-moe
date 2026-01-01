// Moe Atelier Extension - Zero Dependency Version
const extensionName = "moe-atelier";
const defaultSettings = {
    apiUrl: "https://sunlea.de/v1",
    apiKey: "sk-KrGGCsZ8citRzyvcfuNJJqfYJKwVJBCDCTSSsyFBKmr5C0rn",
    model: "gemini-3-pro-image-preview",
    enabled: true,
    commonTags: "masterpiece, best quality",
    // New settings for manual generation button
    generationMode: "direct", // "direct" or "smart"
    autoGenerate: false, // Auto-generate for every AI message
    buttonPosition: "action_bar", // "action_bar" or "floating"
    showButtonAlways: false // Show button always or only on hover
};

// Track which messages have buttons injected
const injectedButtons = new Set();

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

// ==========================================
// MANUAL GENERATION BUTTON FEATURE
// ==========================================

// Inject image generation buttons to AI messages
function injectImageButtons() {
    const context = getContext();
    if (!context || !context.chat) return;

    // Find all AI message elements
    const messageElements = document.querySelectorAll('.mes[is_user="false"]');
    
    messageElements.forEach((messageEl) => {
        const messageId = messageEl.getAttribute('mesid');
        if (!messageId || injectedButtons.has(messageId)) return;

        if (settings.buttonPosition === 'floating') {
            // Floating button on message
            injectFloatingButton(messageEl, messageId);
        } else {
            // Action bar button (default)
            injectActionBarButton(messageEl, messageId);
        }
        
        injectedButtons.add(messageId);
    });
}

// Inject button into action bar
function injectActionBarButton(messageEl, messageId) {
    // Find the action bar (extraMesButtons or mes_buttons)
    let actionBar = messageEl.querySelector('.extraMesButtons');
    if (!actionBar) {
        actionBar = messageEl.querySelector('.mes_buttons');
    }
    
    if (!actionBar) return;

    // Check if button already exists
    if (actionBar.querySelector('.moe-generate-btn')) return;

    // Create the generate button
    const generateBtn = document.createElement('div');
    generateBtn.className = 'moe-generate-btn mes_button fa-solid fa-image interactable';
    if (settings.showButtonAlways) {
        generateBtn.classList.add('moe-always-visible');
    }
    generateBtn.title = 'Generate Image (Moe Atelier)';
    generateBtn.setAttribute('data-mesid', messageId);
    
    // Add click handler
    generateBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onGenerateButtonClick(parseInt(messageId));
    });

    // Insert button at the beginning of action bar
    actionBar.insertBefore(generateBtn, actionBar.firstChild);
}

// Inject floating button on message
function injectFloatingButton(messageEl, messageId) {
    // Check if button already exists
    if (messageEl.querySelector('.moe-floating-generate-btn')) return;

    // Create the floating generate button
    const generateBtn = document.createElement('div');
    generateBtn.className = 'moe-floating-generate-btn';
    if (settings.showButtonAlways) {
        generateBtn.classList.add('moe-always-visible');
    }
    generateBtn.innerHTML = '🖼️';
    generateBtn.title = 'Generate Image (Moe Atelier)';
    generateBtn.setAttribute('data-mesid', messageId);
    
    // Add click handler
    generateBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onGenerateButtonClick(parseInt(messageId));
    });

    // Find message text container and append
    const mesBlock = messageEl.querySelector('.mes_block');
    if (mesBlock) {
        mesBlock.style.position = 'relative';
        mesBlock.appendChild(generateBtn);
    }
}

// Handle generate button click
async function onGenerateButtonClick(messageId) {
    const context = getContext();
    if (!context || !context.chat) return;

    const message = context.chat[messageId];
    if (!message || message.is_user) return;

    // Get the message element
    const messageEl = document.querySelector(`.mes[mesid="${messageId}"]`);
    if (!messageEl) return;

    // Show loading state
    const generateBtn = messageEl.querySelector('.moe-generate-btn');
    if (generateBtn) {
        generateBtn.classList.add('moe-generating');
        generateBtn.classList.remove('fa-image');
        generateBtn.classList.add('fa-spinner', 'fa-spin');
    }

    // Add loading indicator to message
    const mesText = messageEl.querySelector('.mes_text');
    const loadingIndicator = document.createElement('div');
    loadingIndicator.className = 'moe-atelier-loading';
    loadingIndicator.innerHTML = '🎨 Generating image...';
    if (mesText) mesText.appendChild(loadingIndicator);

    try {
        // Extract prompt based on generation mode
        let prompt;
        if (settings.generationMode === 'smart') {
            prompt = await extractSmartPrompt(message.mes);
        } else {
            prompt = extractDirectPrompt(message.mes);
        }

        if (!prompt) {
            throw new Error('Could not extract prompt from message');
        }

        console.log(`[Moe Atelier] Generating image with prompt: ${prompt}`);
        if (window.toastr) window.toastr.info('Generating image...', 'Moe Atelier');

        // Generate the image
        const imageUrl = await generateImage(prompt);

        if (imageUrl) {
            // Append image to message
            const imgTag = `\n\n![Generated Image](${imageUrl})\n`;
            context.chat[messageId].mes += imgTag;
            
            // Update the DOM
            if (eventSource) eventSource.emit(event_types.MESSAGE_UPDATED, messageId);
            
            // Save chat
            context.saveChat();
            
            if (window.toastr) window.toastr.success('Image generated successfully!', 'Moe Atelier');
        }
    } catch (error) {
        console.error('[Moe Atelier] Manual generation failed:', error);
        if (window.toastr) window.toastr.error(`Error: ${error.message}`, 'Moe Atelier');
    } finally {
        // Remove loading state
        if (generateBtn) {
            generateBtn.classList.remove('moe-generating', 'fa-spinner', 'fa-spin');
            generateBtn.classList.add('fa-image');
        }
        if (loadingIndicator && loadingIndicator.parentNode) {
            loadingIndicator.parentNode.removeChild(loadingIndicator);
        }
    }
}

// Direct mode: Clean and use message text as prompt
function extractDirectPrompt(messageText) {
    // Remove HTML tags
    let text = messageText.replace(/<[^>]*>/g, '');
    // Remove markdown images
    text = text.replace(/!\[.*?\]\(.*?\)/g, '');
    // Remove existing img-prompt tags
    text = text.replace(/<!--\s*img-prompt\s*=\s*["'].*?["']\s*-->/g, '');
    // Clean up whitespace
    text = text.replace(/\s+/g, ' ').trim();
    // Truncate if too long (max 500 chars for prompt)
    if (text.length > 500) {
        text = text.substring(0, 500) + '...';
    }
    return text;
}

// Smart mode: Use LLM to summarize message into visual description
async function extractSmartPrompt(messageText) {
    const cleanText = extractDirectPrompt(messageText);
    
    const baseUrl = sanitizeUrl(settings.apiUrl);
    const endpoint = `${baseUrl}/chat/completions`;

    const systemPrompt = `You are a visual description assistant. Given a text passage, extract and summarize the key visual elements into a concise image generation prompt. Focus on:
- Characters and their appearance (hair, eyes, clothing, pose)
- Setting and environment
- Mood and atmosphere
- Key actions or expressions

Output ONLY the image prompt, nothing else. Keep it under 200 words. Use comma-separated tags style.`;

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${settings.apiKey}`
            },
            body: JSON.stringify({
                model: settings.model,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: `Extract visual description from this text:\n\n${cleanText}` }
                ],
                stream: false
            })
        });

        if (!response.ok) {
            throw new Error(`API Error: ${response.status}`);
        }

        const data = await response.json();
        if (data.choices && data.choices[0] && data.choices[0].message) {
            return data.choices[0].message.content.trim();
        }
        
        // Fallback to direct mode
        return cleanText;
    } catch (error) {
        console.warn('[Moe Atelier] Smart prompt extraction failed, falling back to direct mode:', error);
        return cleanText;
    }
}

// Auto-generate for new messages if enabled
async function onMessageReceivedAutoGenerate(messageId) {
    if (!settings.enabled || !settings.autoGenerate) return;

    const context = getContext();
    if (!context || !context.chat) return;

    const message = context.chat[messageId];
    if (!message || message.is_user) return;

    // Small delay to let the message render
    await new Promise(r => setTimeout(r, 500));
    
    // Inject buttons first
    injectImageButtons();
    
    // Then auto-generate
    await onGenerateButtonClick(messageId);
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

    // Create an AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

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
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

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
        clearTimeout(timeoutId);
        console.error('[Moe Atelier] Image generation failed:', error);

        let errorMessage = error.message;
        if (error.name === 'AbortError') {
            errorMessage = "Connection timed out (30s). Please check your API URL or try again later.";
        }

        if (window.toastr) window.toastr.error(`Error: ${errorMessage}`, "Moe Atelier Error");
        return null;
    }
}

// Settings HTML
const settingsHtml = `
<div class="moe-atelier-settings">
    <h3>Moe Atelier Settings</h3>
    <div class="moe-atelier-setting-item"><label>Enable</label><input type="checkbox" id="moe_enabled" /></div>
    <div class="moe-atelier-setting-item">
        <label>API URL <small>(e.g. https://run.mocky.io/v3/YOUR_ID)</small></label>
        <input type="text" id="moe_api_url" />
    </div>
    <div class="moe-atelier-setting-item"><label>API Key</label><input type="password" id="moe_api_key" /></div>
    <div class="moe-atelier-setting-item"><label>Model</label><input type="text" id="moe_model" /></div>
    <div class="moe-atelier-setting-item"><label>Tags</label><input type="text" id="moe_common_tags" /></div>
    
    <h4 style="margin-top: 15px; border-top: 1px solid rgba(255,255,255,0.2); padding-top: 10px;">🖼️ Manual Generation</h4>
    <div class="moe-atelier-setting-item">
        <label>Generation Mode</label>
        <select id="moe_generation_mode">
            <option value="direct">Direct (use message text)</option>
            <option value="smart">Smart (LLM summarizes)</option>
        </select>
    </div>
    <div class="moe-atelier-setting-item">
        <label>Auto-generate for all AI messages</label>
        <input type="checkbox" id="moe_auto_generate" />
    </div>
    <div class="moe-atelier-setting-item">
        <label>Button Position</label>
        <select id="moe_button_position">
            <option value="action_bar">Action Bar</option>
            <option value="floating">Floating on Message</option>
        </select>
    </div>
    <div class="moe-atelier-setting-item">
        <label>Always show button (not just on hover)</label>
        <input type="checkbox" id="moe_show_button_always" />
    </div>
    
    <div class="moe-atelier-setting-item" style="margin-top:15px; border-top: 1px solid rgba(255,255,255,0.2); padding-top: 10px;">
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
        
        // New settings bindings
        bind("moe_auto_generate", "autoGenerate");
        bind("moe_show_button_always", "showButtonAlways");
        
        // Select bindings (special handling)
        const bindSelect = (id, key) => {
            const el = document.getElementById(id);
            if (el) {
                el.value = settings[key];
                el.addEventListener('change', function() {
                    settings[key] = this.value;
                    saveSettings();
                    // Re-inject buttons if position changed
                    if (key === 'buttonPosition') {
                        injectedButtons.clear();
                        document.querySelectorAll('.moe-generate-btn, .moe-floating-generate-btn').forEach(btn => btn.remove());
                        injectImageButtons();
                    }
                });
            }
        };
        bindSelect("moe_generation_mode", "generationMode");
        bindSelect("moe_button_position", "buttonPosition");
    }, 500);
}

// Initialization
jQuery(async () => {
    console.log("[Moe Atelier] Initializing v1.1.0 with Manual Generation Button");

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
        
        // Add slash command for manual generation
        context.slashCommandParser.addCommandObject({
            name: 'moe_generate',
            description: 'Generate image for the last AI message',
            callback: async () => {
                const ctx = getContext();
                if (!ctx || !ctx.chat || ctx.chat.length === 0) {
                    return "No messages found.";
                }
                // Find last AI message
                for (let i = ctx.chat.length - 1; i >= 0; i--) {
                    if (!ctx.chat[i].is_user) {
                        await onGenerateButtonClick(i);
                        return "Generating image...";
                    }
                }
                return "No AI message found.";
            }
        });
    }

    if (eventSource && event_types) {
        // Original tag-based generation
        eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
        
        // Auto-generate if enabled
        eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceivedAutoGenerate);
        
        // Inject buttons when messages are updated/rendered
        eventSource.on(event_types.MESSAGE_RECEIVED, () => {
            setTimeout(injectImageButtons, 100);
        });
        eventSource.on(event_types.MESSAGE_UPDATED, () => {
            setTimeout(injectImageButtons, 100);
        });
    }

    // Initial button injection for existing messages
    setTimeout(injectImageButtons, 1500);
    
    // Also inject on chat load/switch (using MutationObserver as fallback)
    const chatObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.addedNodes.length > 0) {
                setTimeout(injectImageButtons, 100);
                break;
            }
        }
    });
    
    const chatContainer = document.getElementById('chat');
    if (chatContainer) {
        chatObserver.observe(chatContainer, { childList: true, subtree: true });
    }

    window.moeAtelier = {
        settings,
        generateImage,
        toggleSettings,
        injectImageButtons,
        onGenerateButtonClick
    };
    console.log("[Moe Atelier] Ready with Manual Generation Button!");
});
