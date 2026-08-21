export default function RootStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap');
      :root {
        --bg: #14171A;
        --surface: #1C2126;
        --surface2: #262C33;
        --border: #323A42;
        --text: #F1F0EC;
        --muted: #8A9199;
        --accent: #F4B400;
        --accent2: #35C97F;
        --danger: #E5484D;
        --font-display: 'Space Grotesk', sans-serif;
      }
      .font-sans { font-family: 'Inter', sans-serif; }
      .input-field {
        width: 100%;
        padding: 0.65rem 0.85rem;
        border-radius: 0.65rem;
        background: var(--surface);
        border: 1px solid var(--border);
        color: var(--text);
        outline: none;
        font-size: 0.9rem;
      }
      input[type=number]::-webkit-inner-spin-button { opacity: 1; }
    `}</style>
  );
}
