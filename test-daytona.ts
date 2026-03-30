async function run() {
  const API_URL = "http://localhost:3000/api/daytona";

  console.log("Creating sandbox...");
  const createRes = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "create", language: "typescript" }),
  });
  const createData = await createRes.json();
  console.log("Create Data:", createData);
  const sid = createData.sandboxId;
  console.log("Sandbox ID:", sid);

  if (!sid) {
    console.error("Failed to create sandbox");
    return;
  }

  const runCmd = async (cmd: string) => {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "execute", sandboxId: sid, command: cmd }),
    });
    return await res.json();
  };

  console.log("Cloning repo...");
  await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "cloneRepo", sandboxId: sid, repoUrl: "https://github.com/geminiuserpro-dev/do-nothing-comfort" }),
  });
  
  console.log("Starting dev server...");
  const devRes = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "startDevServer", sandboxId: sid, port: 3000, workDir: "/home/daytona/repo" }),
  });
  const devData = await devRes.json();
  console.log("Dev Server Data:", devData);

  console.log("Deleting sandbox...");
  await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "destroy", sandboxId: sid }),
  });
}

run().catch(console.error);
