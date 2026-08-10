/* ================================================================== *
 * Addon: Providers UI
 *
 * Provider forms, parameters, and UI interactions.
 * ================================================================== */

(function () {
    'use strict';

    ChatAddons.register({
        id: 'builtin:providers-ui',
        name: 'Providers UI',
        version: '1.0.0',
        description: 'Provider forms, parameters, and UI interactions.',
        author: 'g4f',
        builtin: true,
        permissions: ['dom:write', 'dom:query'],

        load() {
            return (async () => {})
        }
    })
})();


const load_provider_option = (input, provider_name) => {
    if (input.checked) {
        providerSelect.querySelectorAll(`option[value="${provider_name}"]:not([data-live="true"])`).forEach(
            (el) => el.removeAttribute("disabled")
        );
        providerSelect.querySelectorAll(`option[data-parent="${provider_name}"]:not([data-live="true"])`).forEach(
            (el) => el.removeAttribute("disabled")
        );
        settings.querySelector(`.field.box:has(label[for="${provider_name}-api_key"])`)?.classList.remove("hidden");
        settings.querySelector(`.field.box:has(label[for="${provider_name}-api_base"])`)?.classList.remove("hidden");
    } else {
        providerSelect.querySelectorAll(`option[value="${provider_name}"]:not([data-live="true"])`).forEach(
            (el) => el.setAttribute("disabled", "disabled")
        );
        providerSelect.querySelectorAll(`option[data-parent="${provider_name}"]:not([data-live="true"])`).forEach(
            (el) => el.setAttribute("disabled", "disabled")
        );
    }
};

async function load_providers(providers, provider_options, providersListContainer, providersToggleContainer) {
    providersToggleContainer = providersToggleContainer || settingsContent;
    providers.sort((a, b) => a.label.localeCompare(b.label));
    const optGroupCore = document.createElement("optgroup");
    optGroupCore.label = "Core Providers";
    providers.forEach((provider) => {
        if (provider.hf_space) {
            return;
        }
        let option = document.createElement("option");
        option.value = provider.name;
        option.dataset.label = provider.label;
        option.text = provider.label
            + (window.getModelTags ? getModelTags(provider) : "")
            + (provider.hf_space ? " 🤗" : "")
            + (provider.nodriver ? " 🌐" : "")
            + (!provider.nodriver && provider.auth ? " 🔑" : "")
            + (provider.live > 0 ? " 🟢" : "")
        if (provider.parent)
            option.dataset.parent = provider.parent;
        optGroupCore.appendChild(option);
    });
    providerSelect.appendChild(optGroupCore);
    providerSelect.selectedIndex = 0;
    if (!document.body.classList.contains("screen-reader")) {
        let providersContainer = document.createElement("div");
        providersContainer.classList.add("field", "collapsible");
        providersContainer.innerHTML = `
            <div class="collapsible-header">
                <span class="label">${framework.translate('Providers (Enable/Disable)')}</span>
                <i class="fa-solid fa-chevron-down"></i>
            </div>
            <div class="collapsible-content hidden"></div>
        `;
        providersToggleContainer.appendChild(providersContainer);

        providers.forEach((provider) => {
            if (!provider.parent || provider.name == "PuterJS") {
                const name = provider.parent || provider.name;
                let option = document.createElement("div");
                option.classList.add("provider-item");
                let api_key = appStorage.getItem(`${name}-api_key`);
                option.innerHTML = `
                    <span class="label">${framework.translate("Enable")} ${provider.label}</span>
                    <input id="Provider${name}" type="checkbox" name="Provider${name}" value="${name}" class="provider" ${(provider.active_by_default || api_key) ? 'checked="checked"' : ''}/>
                    <label for="Provider${name}" class="toogle" title="Remove provider from dropdown"></label>
                `;
                option.querySelector("input").addEventListener("change", (event) => load_provider_option(event.target, name));
                providersContainer.querySelector(".collapsible-content").appendChild(option);
                provider_options[name] = option;
            }
        });

        providersContainer.querySelector(".collapsible-header").addEventListener('click', (e) => {
            providersContainer.querySelector(".collapsible-content").classList.toggle('hidden');
            providersContainer.querySelector(".collapsible-header").classList.toggle('active');
        });

        // Add Live Providers toggle
        let liveProvidersToggle = document.createElement("div");
        liveProvidersToggle.classList.add("provider-item");
        const liveEnabled = appStorage.getItem("enableLiveProviders") !== "false";
        liveProvidersToggle.innerHTML = `
            <span class="label">Enable Live Providers</span>
            <input id="enableLiveProviders" type="checkbox" name="enableLiveProviders" value="live" class="provider-toggle" ${liveEnabled ? 'checked="checked"' : ''}/>
            <label for="enableLiveProviders" class="toogle" title="Enable or disable all live providers in dropdown"></label>
        `;
        liveProvidersToggle.querySelector("input").addEventListener("change", (event) => {
            appStorage.setItem("enableLiveProviders", event.target.checked ? "true" : "false");
            const optgroup = document.getElementById("live-providers-optgroup");
            if (optgroup) {
                optgroup.disabled = !event.target.checked;
            }
        });
        providersContainer.querySelector(".collapsible-content").insertBefore(liveProvidersToggle, providersContainer.querySelector(".collapsible-content").firstChild);

        // Add Custom Providers toggle
        let customProvidersToggle = document.createElement("div");
        customProvidersToggle.classList.add("provider-item");
        const customEnabled = appStorage.getItem("enableCustomProviders") !== "false";
        customProvidersToggle.innerHTML = `
            <span class="label">Enable Custom Providers</span>
            <input id="enableCustomProviders" type="checkbox" name="enableCustomProviders" value="custom" class="provider-toggle" ${customEnabled ? 'checked="checked"' : ''}/>
            <label for="enableCustomProviders" class="toogle" title="Enable or disable custom providers in dropdown"></label>
        `;
        customProvidersToggle.querySelector("input").addEventListener("change", (event) => {
            appStorage.setItem("enableCustomProviders", event.target.checked ? "true" : "false");
            const optgroup = document.getElementById("custom-providers-optgroup");
            if (optgroup) {
                optgroup.disabled = !event.target.checked;
            }
        });
        providersContainer.querySelector(".collapsible-content").insertBefore(customProvidersToggle, providersContainer.querySelector(".collapsible-content").firstChild.nextSibling);
    }
    load_provider_login_urls(providersListContainer, providers);
    await load_settings(provider_options);
    loadModels(providers);
}
function load_provider_login_urls(providersListContainer, providers = []) {
    for (const provider of providers) {
        if (provider.parent || provider.name == "AnyProvider") {
            continue;
        }
        let childs = providers.filter((p) => p.parent == provider.name).map((p) => p.name);
        let providerBox = document.createElement("div");
        providerBox.classList.add("field", "box");
        if (!provider.active_by_default || appStorage.getItem(`Provider${provider.name}`) === "false") {
            providerBox.classList.add("hidden");
        }
        let isChecked = false;
        async function checkStatus() {
            setTimeout(async () => {
                if (isChecked) {
                    return;
                }
                isChecked = true;
                const label = providerBox.querySelector('label');
                if (!label) {
                    return;
                }
                label.textContent = label.textContent.replaceAll(" ✅", "") + " 🔄";
                const quota = await get_quota(provider.name);
                label.textContent = label.textContent.replaceAll(" 🔄", "").replaceAll(" ✅", "")
                if (quota) {
                    label.textContent += " ✅";
                }
            }, Math.random() * 100);
        }
        providerBox.addEventListener('mouseenter', checkStatus);
        const label = provider.label || provider.name;
        childs = childs.map((child) => `${child}-api_key`).join(" ");
        const login_provider = provider.name.replace("AI", "").replace("Api", "").toLowerCase();
        let oauthButton = "";

        // Add OAuth button for providers that support it (server-side endpoint)
        if (provider.login) {
            oauthButton = `<button class="oauth-btn" data-provider="${provider.name}" data-login-url="/backend-api/v2/oauth/${provider.name}" title="${framework.translate("Login to")} ${framework.escape(label)}">${framework.translate('Login')}</button>`;
        }

        const apiKeyLink = ["Pollinations", "HuggingFace", "Airforce"].includes(provider.name)
            ? `<a href="https://g4f.dev/members?provider=${login_provider}&redirect=${encodeURIComponent(window.location.href.split("#")[0])}" title="${framework.translate("Login to")} ${framework.escape(label)}">${framework.translate('Login')}</a>`
            : (provider.login_url ? `<a href="${framework.escape(provider.login_url)}" target="_blank" title="${framework.translate("Login to")} ${framework.escape(label)}">${framework.translate('Get API key')}</a>` : "");
        const inputId = `${provider.name}-api_key`;
        const storageKey = provider.name == "PuterJS" ? "puter.auth.token" : inputId;
        providerBox.innerHTML = `
            <label for="${inputId}" class="label" title="">${framework.escape(label)}:</label>
        ` + (oauthButton || (apiKeyLink ? `
            <input type="text" id="${inputId}" name="${provider.name}[api_key]" class="${childs}" placeholder="api_key" autocomplete="off" data-storage-key="${storageKey}"/>
        ` + apiKeyLink : ""));

        if (provider.name == "PuterJS") {
            const link = providerBox.querySelector("a");
            link.textContent = framework.translate("Login");
            link.addEventListener("click", async (event) => {
                event.preventDefault();
                await (new window.Puter()).signIn().then((res) => {
                    console.log('PuterJS signed in:', res);
                    providerBox.querySelector("input").value = res.token;
                    appStorage.setItem(storageKey, res.token);
                });
            });
        }

        providerBox.addEventListener("click", () => {
            isChecked = false;
            setTimeout(checkStatus, 100);
        });

        // Add OAuth button event listener
        if (oauthButton) {
            providerBox.querySelector(".oauth-btn").addEventListener("click", async (event) => {
                const provider = event.target.dataset.provider;
                event.target.disabled = true;
                event.target.textContent = "Authenticating...";
                try {
                    const loginUrl = event.target.dataset.loginUrl || `/backend-api/v2/oauth/${provider}`;
                    const response = await fetch(loginUrl, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({ action: "start" })
                    });
                    const result = await response.json();

                    if (result.status === "pending" && result.user_code && result.verification_uri) {
                        showOAuthCodePrompt(result.user_code, result.verification_uri);
                        showToast("GitHub Copilot authorization started. Click Open GitHub and enter the code.", "info", 10000);

                        // Poll for completion
                        let pollResult;
                        const maxPollAttempts = 45;
                        let pollAttempts = 0;
                        while (pollAttempts < maxPollAttempts) {
                            pollAttempts += 1;
                            await new Promise(resolve => setTimeout(resolve, result.interval ? result.interval * 1000 : 5000));
                            const pollResponse = await fetch(loginUrl, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ action: "poll", device_code: result.device_code })
                            });
                            pollResult = await pollResponse.json();

                            if (pollResult.status === "success") {
                                showToast("OAuth authentication successful!", "success");
                                await load_providers(providers, {}, providersListContainer, null);
                                break;
                            }
                            if (pollResult.status !== "pending") {
                                showToast(`OAuth failed: ${pollResult.error?.message || pollResult.message || "Unknown error"}`, "error");
                                break;
                            }
                        }

                        if (pollAttempts >= maxPollAttempts) {
                            showToast("OAuth poll timed out. Please retry.", "error");
                        }

                    } else if (result.status === "success") {
                        showToast("OAuth authentication successful!", "success");
                        await load_providers(providers, {}, providersListContainer, null);
                    } else {
                        showToast(`OAuth failed: ${result.error?.message || result.message || "Unknown error"}`, "error");
                    }
                } catch (error) {
                    showToast(`OAuth error: ${error.message}`, "error");
                } finally {
                    event.target.disabled = false;
                    event.target.textContent = framework.translate('Login');
                }
            });
        }
        providersListContainer.querySelector(".collapsible-content").appendChild(providerBox);
    }
}

export default {
    load_provider_option,
    load_providers,
    load_provider_login_urls,
};