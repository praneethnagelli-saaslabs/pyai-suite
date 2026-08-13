# Accessibility (spec #90)

- Keyboard navigation first; Cmd/Ctrl+K command palette is the primary nav.
- Focus management: visible focus rings; focus returns to trigger after dialogs.
- Screen-reader labels on all controls; ARIA roles for timeline, diff, run list.
- Accessible color contrast; status conveyed by text + icon, not color alone.
- Respect `prefers-reduced-motion`: disable non-essential animation.
- All user-facing strings centralized for i18n (see i18n.md); no hardcoded text in components.
