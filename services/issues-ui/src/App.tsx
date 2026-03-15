function App() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg)",
        color: "var(--text)",
      }}
    >
      <img
        src="/cadence-icon.svg"
        alt="Cadence"
        width={64}
        height={64}
        style={{ marginBottom: "1rem" }}
      />
      <h1
        style={{
          fontFamily: "'Space Grotesk', sans-serif",
          fontWeight: 700,
          fontSize: "2.4rem",
          letterSpacing: "-0.02em",
          color: "var(--primary)",
        }}
      >
        Cadence
      </h1>
      <p
        style={{
          color: "var(--text-secondary)",
          marginTop: "0.5rem",
          fontSize: "1.05rem",
        }}
      >
        Issue tracking, visualized.
      </p>
    </div>
  );
}

export default App;
