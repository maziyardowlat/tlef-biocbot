const API = 'http://localhost:7736/api/biocbot';

document.getElementById('ping').onclick = async () => {
  const out = document.getElementById('output');
  out.textContent = '…fetching…';
  try {
    const res = await fetch(`${API}/api/biocbot`);
    const data = await res.json();
    out.textContent = JSON.stringify(data, null, 2);
  } catch (err) {
    out.textContent = 'Error: ' + err;
  }
};
