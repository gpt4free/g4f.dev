// Shared social menu for the landing page, chat welcome screen and footers.
const accounts = [
    { name: "X", handle: "@g4f_space", icon: "X", url: "https://x.com/g4f_space" },
    { name: "Facebook", handle: "G4F community", icon: "f", url: "https://www.facebook.com/groups/1489669470047458" },
    { name: "Instagram", handle: "@g4f.dev", icon: "◎", url: "https://www.instagram.com/g4f.dev/" },
    { name: "GitHub", handle: "gpt4free/g4f.dev", icon: "github", url: "https://github.com/gpt4free/g4f.dev" },
];

class SocialLinks extends HTMLElement {
    connectedCallback() {
        if (this.firstElementChild) return;

        const button = document.createElement("button");
        button.type = "button";
        button.className = "social-links__trigger";
        button.textContent = "Follow G4F";
        button.setAttribute("aria-expanded", "false");
        button.setAttribute("aria-haspopup", "true");

        const menu = document.createElement("div");
        menu.className = "social-links__menu";
        menu.hidden = true;
        const heading = document.createElement("span");
        heading.className = "social-links__heading";
        heading.textContent = "Find us online";
        menu.append(heading);

        for (const { name, handle, icon, url } of accounts) {
            const link = document.createElement("a");
            link.href = url;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.setAttribute("aria-label", `${name} (${handle}), opens in a new tab`);
            const badge = document.createElement("span");
            badge.className = "social-links__icon";
            badge.setAttribute("aria-hidden", "true");
            if (icon === "github") {
                const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
                svg.setAttribute("viewBox", "0 0 16 16");
                svg.setAttribute("fill", "currentColor");
                const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
                path.setAttribute("d", "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82A7.65 7.65 0 0 1 8 4.73c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z");
                svg.append(path);
                badge.append(svg);
            } else {
                badge.textContent = icon;
            }
            const label = document.createElement("span");
            label.className = "social-links__label";
            label.textContent = name;
            const detail = document.createElement("small");
            detail.textContent = handle;
            label.append(detail);
            link.append(badge, label);
            menu.append(link);
        }

        this.append(button, menu);
        const setOpen = (open) => {
            menu.hidden = !open;
            button.setAttribute("aria-expanded", String(open));
        };
        button.addEventListener("click", () => setOpen(menu.hidden));
        this.addEventListener("mouseenter", () => {
            if (matchMedia("(hover: hover)").matches) setOpen(true);
        });
        this.addEventListener("mouseleave", () => {
            if (!menu.contains(document.activeElement)) setOpen(false);
        });
        this.addEventListener("focusout", (event) => {
            if (!this.contains(event.relatedTarget) && !this.matches(":hover")) setOpen(false);
        });
        this.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                setOpen(false);
                button.focus();
            }
        });
        this.onOutsidePointerDown = (event) => {
            if (!this.contains(event.target)) setOpen(false);
        };
        document.addEventListener("pointerdown", this.onOutsidePointerDown);
    }

    disconnectedCallback() {
        if (this.onOutsidePointerDown) {
            document.removeEventListener("pointerdown", this.onOutsidePointerDown);
            this.onOutsidePointerDown = null;
        }
    }
}

customElements.define("social-links", SocialLinks);
