// ── Navigation ──────────────────────────────────────────
const navLinks = document.querySelectorAll('.nav-link');
const sections = document.querySelectorAll('.section');

function navigate(id) {
  sections.forEach(s => s.classList.toggle('active', s.id === id));
  navLinks.forEach(l => l.classList.toggle('active', l.dataset.section === id));
}

navLinks.forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    navigate(link.dataset.section);
  });
});

// ── Counter ──────────────────────────────────────────────
let count = 0;
const display   = document.getElementById('counterDisplay');
const histList  = document.getElementById('historyList');

function updateDisplay(newCount, label) {
  count = newCount;
  display.textContent = count;
  display.style.color = count < 0 ? '#ff4d6d' : count > 0 ? '#6c63ff' : '#e8e8f0';

  // bump animation
  display.classList.remove('bump');
  void display.offsetWidth; // reflow
  display.classList.add('bump');
  setTimeout(() => display.classList.remove('bump'), 150);

  // history
  const empty = histList.querySelector('.empty');
  if (empty) empty.remove();

  const li = document.createElement('li');
  const time = new Date().toLocaleTimeString();
  li.textContent = `${time} — ${label} → ${count}`;
  histList.prepend(li);

  // keep history to 15 items
  while (histList.children.length > 15) histList.removeChild(histList.lastChild);
}

document.getElementById('incrementBtn').addEventListener('click', () => updateDisplay(count + 1, '+1'));
document.getElementById('decrementBtn').addEventListener('click', () => updateDisplay(count - 1, '−1'));
document.getElementById('resetBtn').addEventListener('click', () => updateDisplay(0, 'reset'));

// keyboard shortcuts on counter page
document.addEventListener('keydown', e => {
  const active = document.querySelector('.section.active');
  if (!active || active.id !== 'counter') return;
  if (e.key === 'ArrowUp')   updateDisplay(count + 1, '+1');
  if (e.key === 'ArrowDown') updateDisplay(count - 1, '−1');
  if (e.key === 'r' || e.key === 'R') updateDisplay(0, 'reset');
});

// ── Notes ────────────────────────────────────────────────
const noteInput   = document.getElementById('noteInput');
const addNoteBtn  = document.getElementById('addNoteBtn');
const notesList   = document.getElementById('notesList');

function addNote() {
  const text = noteInput.value.trim();
  if (!text) return;

  const empty = notesList.querySelector('.empty');
  if (empty) empty.remove();

  const li = document.createElement('li');

  const span = document.createElement('span');
  span.className = 'note-text';
  span.textContent = text;

  const del = document.createElement('button');
  del.className = 'delete-btn';
  del.title = 'Delete note';
  del.textContent = '✕';
  del.addEventListener('click', () => {
    li.style.opacity = '0';
    li.style.transform = 'translateX(20px)';
    li.style.transition = 'opacity 0.2s, transform 0.2s';
    setTimeout(() => {
      li.remove();
      if (notesList.children.length === 0) {
        const placeholder = document.createElement('li');
        placeholder.className = 'empty';
        placeholder.textContent = 'No notes yet. Add one above!';
        notesList.appendChild(placeholder);
      }
    }, 200);
  });

  li.appendChild(span);
  li.appendChild(del);
  notesList.prepend(li);
  noteInput.value = '';
  noteInput.focus();
}

addNoteBtn.addEventListener('click', addNote);
noteInput.addEventListener('keydown', e => { if (e.key === 'Enter') addNote(); });
