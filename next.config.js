/** @type {import('next').NextConfig} */
const nextConfig = {
  // Output standalone per deploy minimale su Windows Server + IIS:
  // produce `.next/standalone/` con il server.js autonomo e i soli
  // node_modules davvero necessari (~30 MB invece di ~500 MB).
  // Vedi DEPLOY-SERVER.md per la procedura completa.
  output: "standalone",
};

export default nextConfig;
