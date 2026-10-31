(() => {
  const requestForm = document.getElementById("request");
  const verifyForm = document.getElementById("verify");
  const message = document.getElementById("message");

  async function send(path, payload) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Please try again later.");
    return result;
  }

  requestForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.textContent = "Requesting code…";
    try {
      await send("/api/auth/request", {});
      requestForm.hidden = true;
      verifyForm.hidden = false;
      message.textContent =
        "If delivery is configured, a code has been sent to the designated address.";
    } catch (e) {
      message.textContent = e.message;
    }
  });

  verifyForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.textContent = "Verifying…";
    try {
      await send("/api/auth/verify", {
        code: document.getElementById("code").value.trim(),
      });
      location.replace("/");
    } catch (e) {
      message.textContent = e.message;
    }
  });
})();
