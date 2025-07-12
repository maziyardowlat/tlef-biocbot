require('dotenv').config();
const express = require('express');
const path = require('path');
const connectDB = require('./db');
const exampleRoutes = require('./routes/example/hello');
const Todo = require('./models/Todo');

const app = express();
const port = process.env.TLEF_BIOCBOT_PORT || 8080;

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());

// Page routes
app.get('/settings', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/settings.html'));
});

// API endpoint
app.use('/api/example', exampleRoutes);

// List all todos
app.get('/api/todos', async (req, res) => {
  const todos = await Todo.find();
  res.json(todos);
});

// Add a todo
app.post('/api/todos', async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Text is required' });
  const todo = new Todo({ text });
  await todo.save();
  res.status(201).json(todo);
});

// Remove a todo
app.delete('/api/todos/:id', async (req, res) => {
  const { id } = req.params;
  const result = await Todo.findByIdAndDelete(id);
  if (!result) return res.status(404).json({ error: 'Todo not found' });
  res.json({ success: true });
});

// Update a todo (text or done)
app.put('/api/todos/:id', async (req, res) => {
  const { id } = req.params;
  const { text, done } = req.body;
  console.log('PUT /api/todos/:id', id, req.body); // <-- Add this
  const update = {};
  if (typeof text === 'string') update.text = text;
  if (typeof done === 'boolean') update.done = done;
  try {
    const todo = await Todo.findByIdAndUpdate(id, update, { new: true });
    if (!todo) {
      console.log('Todo not found for update:', id);
      return res.status(404).json({ error: 'Todo not found' });
    }
    res.json(todo);
  } catch (err) {
    console.error('Error updating todo:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

connectDB()
  .then(() => {
    console.log('MongoDB connected!');
    // Start your server here, e.g. app.listen(...)
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
  console.log( 'test again' );
});
