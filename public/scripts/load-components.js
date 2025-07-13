// Dynamically load sidebar and footer into each page
async function loadComponent(id, path) {
  const el = document.getElementById(id);
  if (el) {
    try {
      const res = await fetch(path);
      if (res.ok) {
        el.innerHTML = await res.text();
      } else {
        el.innerHTML = `<div style="color:red;">Failed to load ${path}</div>`;
      }
    } catch (e) {
      el.innerHTML = `<div style="color:red;">Error loading ${path}</div>`;
    }
  }
}
loadComponent('navbar', 'components/navbar.html');
loadComponent('footer', 'components/footer.html');
