/* ================================================================== *
 * Addon: Baked Credits
 *
 * Extracted from chat.v1.js lines 109-221.
 * ================================================================== */

(function () {
    'use strict';

    ChatAddons.register({
        id: 'builtin:baked-credits',
        name: 'Baked Credits',
        version: '1.0.0',
        description: 'Extracted from chat.v1.js lines 109-221.',
        author: 'g4f',
        builtin: true,
        permissions: ['dom:query'],

        load() {
            return (async () => {})
        }
    });
})();

// --- Baked credits (proof-of-work cakes) ---------------------------
const cakeCreditsText = document.getElementById('cake-credits-text');

function formatCakeCredits(cents, bakedToday) {
    const dollars = (cents / 100).toFixed(2);
    return `<i class="fa-solid fa-cake-candles" aria-hidden="true"></i> $${dollars}`;
}

function updateCakeCredits(cents, bakedToday) {
    if (!cakeCreditsText) return;
    cakeCreditsText.innerHTML = formatCakeCredits(cents || 0, bakedToday);
    cakeCreditsText.title = `Baked credits: $${((cents || 0) / 100).toFixed(2)}${bakedToday != null ? ` · ${bakedToday} baked today` : ''}`;
    if (tierLimitsRow) tierLimitsRow.classList.remove('hidden');
}

// Poll the cake worker /status endpoint for baked credits
async function refreshCakeStatus() {
    try {
        const res = await fetch('https://g4f.space/cake/status', { credentials: 'include' });
        if (res.ok) {
            const data = await res.json();
            updateCakeCredits(data.credit_cents, data.baked_today);
        }
    } catch (e) { /* network blocked — ignore */ }
}

refreshCakeStatus();
setInterval(refreshCakeStatus, 30000);

function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(0) + 'K';
    return (Math.round(num * 10) / 10).toString();
}

domReady.then(() => {
    // Shared DOM refs used by tier/cake UI below
    const tierLimitsRow = document.getElementById('tier-limits-row');

    // Listen for user tier updates from API responses
    window.addEventListener('userTierUpdate', (event) => {
        const userInfo = event.detail;
        const infoBar = document.getElementById('user-tier-info');
        const tierText = document.getElementById('user-tier-text');
        const maxTokensText = document.getElementById('max-tokens-text');
        const maxRequestsText = document.getElementById('max-requests-text');
        
        if (infoBar && (userInfo.tier || userInfo.remainingTokens !== null || userInfo.remainingRequests !== null)) {
            if (userInfo.tier) {
                infoBar.setAttribute('data-tier', userInfo.tier);
                // Only update tier text if user is not logged in (keep username if logged in)
                const sidebarLogoutBtn = document.getElementById('sidebar-logout-btn');
                if (sidebarLogoutBtn && sidebarLogoutBtn.classList.contains('hidden')) {
                    if (tierText) tierText.textContent = userInfo.tier;
                }
            }
            if (maxTokensText && (userInfo.remainingTokens !== null || userInfo.limitTokens !== null) && (userInfo.remainingTokens && userInfo.limitTokens)) {
                const remaining = userInfo.remainingTokens !== null ? formatNumber(userInfo.remainingTokens) : '-';
                const limit = userInfo.limitTokens !== null ? formatNumber(userInfo.limitTokens) : '-';
                maxTokensText.innerHTML = `<i class="fa-solid fa-coins" aria-hidden="true"></i> ${remaining}/${limit}`;
                maxTokensText.title = `Tokens: ${remaining} remaining of ${limit}`;
                if (tierLimitsRow) tierLimitsRow.classList.remove('hidden');
            }
            if (maxRequestsText && (userInfo.remainingRequests !== null || userInfo.limitRequests !== null) && (userInfo.remainingRequests && userInfo.limitRequests)) {
                let remaining = userInfo.remainingRequests !== null ? userInfo.remainingRequests : '-';
                let limit = userInfo.limitRequests !== null ? userInfo.limitRequests : '-';
                remaining = remaining > 1e3 ? (remaining / 1e3).toFixed(1) + 'K' : remaining;
                limit = limit > 1e3 ? (limit / 1e3).toFixed(1) + 'K' : limit;
                maxRequestsText.innerHTML = `<i class="fa-solid fa-list" aria-hidden="true"></i> ${remaining}/${limit}`;
                maxRequestsText.title = `Requests: ${remaining} remaining of ${limit}`;
                if (tierLimitsRow) tierLimitsRow.classList.remove('hidden');
            }
        }
    });
});

// Settings tabs functionality
const settingsTabs = document.querySelectorAll('.settings-tab');
const tabContents = document.querySelectorAll('.settings-tab-content');

settingsTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        const targetTab = tab.dataset.tab;

        // Update active tab button
        settingsTabs.forEach(t => {
            t.classList.remove('active');
            t.setAttribute('aria-selected', 'false');
        });
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');

        // Update active tab content
        tabContents.forEach(content => {
            content.classList.remove('active');
        });
        const targetContent = document.getElementById(`tab-${targetTab}`);
        if (targetContent) {
            targetContent.classList.add('active');
        }

        // Save active tab to appStorage
        appStorage.setItem('settings-active-tab', targetTab);
    });
});

// Restore last active tab
const savedTab = appStorage.getItem('settings-active-tab');
if (savedTab) {
    const tabButton = document.querySelector(`.settings-tab[data-tab="${savedTab}"]`);
    if (tabButton) {
        tabButton.click();
    }
}

export default {
    formatCakeCredits,
    updateCakeCredits,
    refreshCakeStatus,
};