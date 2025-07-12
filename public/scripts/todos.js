document.addEventListener('DOMContentLoaded', () => {
  const todoList = document.getElementById('todo-list');
  const todoForm = document.getElementById('todo-form');
  const todoInput = document.getElementById('todo-input');

  // Fetch and display todos
  async function loadTodos() {
    todoList.innerHTML = '<li>Loading...</li>';
    try {
      const res = await fetch('/api/todos');
      const todos = await res.json();
      if (todos.length === 0) {
        todoList.innerHTML = '<li>No todos yet!</li>';
        return;
      }
      todoList.innerHTML = '';
      todos.forEach(todo => {
        const li = document.createElement('li');
        // Checkbox for done/undone
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = todo.done;
        checkbox.onchange = async () => {
          await fetch(`/api/todos/${todo._id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ done: checkbox.checked })
          });
          loadTodos();
        };
        li.appendChild(checkbox);

        // Todo text
        const span = document.createElement('span');
        span.textContent = todo.text;
        if (todo.done) span.style.textDecoration = 'line-through';
        li.appendChild(span);

        // Edit button
        const editBtn = document.createElement('button');
        editBtn.textContent = 'Edit';
        editBtn.className = 'edit-btn';
        editBtn.onclick = async () => {
          const newText = prompt('Edit todo:', todo.text);
          if (newText && newText !== todo.text) {
            await fetch(`/api/todos/${todo._id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: newText })
            });
            loadTodos();
          }
        };
        li.appendChild(editBtn);

        // Delete button
        const delBtn = document.createElement('button');
        delBtn.textContent = 'Delete';
        delBtn.className = 'delete-btn';
        delBtn.onclick = async () => {
          await fetch(`/api/todos/${todo._id}`, { method: 'DELETE' });
          loadTodos();
        };
        li.appendChild(delBtn);

        todoList.appendChild(li);
      });
    } catch (err) {
      todoList.innerHTML = '<li>Error loading todos</li>';
    }
  }

  // Add new todo
  todoForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = todoInput.value.trim();
    if (!text) return;
    await fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    todoInput.value = '';
    loadTodos();
  });

  loadTodos();
}); 