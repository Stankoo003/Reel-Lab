export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui", padding: 32 }}>
      <h1>ReelLab API</h1>
      <p>This host serves the ReelLab mobile app. Health: <a href="/actuator/health">/actuator/health</a></p>
    </main>
  );
}
