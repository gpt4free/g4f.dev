/* ================================================================== *
 * Addon: Ask GPT
 *
 * Core ask_gpt implementation for sending prompts to providers and handling responses.
 * ================================================================== */

(function () {
    'use strict';

    ChatAddons.register({
        id: 'builtin:ask-gpt',
        name: 'Ask GPT',
        version: '1.0.0',
        description: 'Core ask_gpt implementation for sending prompts to providers and handling responses.',
        author: 'g4f',
        builtin: true,
        permissions: ['net:fetch', 'dom:write', 'dom:query'],

        load() {
            return (async () => {})
        }
    })
})();

export default { };
