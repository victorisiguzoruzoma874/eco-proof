// Module entrypoint; the classic source also supports existing script embeds.
if (!customElements.get('robot-chat')) {
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL('widget.js', import.meta.url).href;
    script.onload = resolve; script.onerror = reject;
    document.head.append(script);
  });
}
