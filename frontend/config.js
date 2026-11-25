// Local development may call the API directly; production uses the same-origin hosting proxy.
// Never put Supabase keys, admin passwords, or session secrets in frontend configuration.
window.IMF_API_URL =
  window.IMF_API_URL ??
  (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:5001"
    : "");
