// Import dependencies
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const socketio = require('socket.io');
const { GridFSBucket } = require('mongodb');
const multer = require('multer');
const GridFsStorage = require('multer-gridfs-storage');
const Grid = require('gridfs-stream');
const sharp = require('sharp');
const path = require('path');



const { GridFsBucket } = mongoose.mongo;


const generateUniqueId = require('generate-unique-id');
const storage = multer.diskStorage({
  destination: './uploads/',
  filename: function(req, file, cb) {
    cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname));
  }
});

// Initialize upload
const upload = multer({
  storage: storage,
  limits: {
    limits: { fileSize: 10 * 1024 * 1024 }
  },
  fileFilter: function(req, file, cb) {
    checkFileType(file, cb);
  }
}).single('avatar');

// Check file type
function checkFileType(file, cb) {
  // Allowed extensions
  const filetypes = /jpeg|jpg|png|gif/;

  // Check the extension
  const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

  // Check the mime type
  const mimetype = filetypes.test(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb('Error: Images only!');
  }
}




// Set up express app
const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cors());

// Set up MongoDB connection
mongoose.connect('mongodb://localhost/chat_app', { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('Connected to MongoDB'))
  .catch(error => console.log('Error connecting to MongoDB', error));

// Define database schema
const userSchema = new mongoose.Schema({
  username: { type: String, required: true },
  email: { type: String, required: true },
  password: { type: String, required: true },
  avatar: { type: String, required: false },
  createdAt: { type: Date, default: Date.now },
});

const roomSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  createdAt: { type: Date, default: Date.now },
  description: { type: String, required: true },
  password: {
    type: String,
    required: false // password is optional
  },
  isPrivate: { type: Boolean, default: false },
  url: { type: String, required: true },
});



const messageSchema = new mongoose.Schema({
  text: { type: String, required: true },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  room: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true },
  createdAt: { type: Date, default: Date.now },
});

const User = mongoose.model('User', userSchema);
const Room = mongoose.model('Room', roomSchema);
const Message = mongoose.model('Message', messageSchema);

// Define JWT secret
const secret = 'secret123';

// Define API endpoints
app.post('/api/register', (req, res) => {
  upload(req, res, async (err) => {
    if (err) {
      console.error(err);
      return res.status(400).json({ message: err.message });
    }

    // Check if all fields are present
    if (!req.body.username || !req.body.email || !req.body.password) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    // If the avatar field is present, set the filename to the uploaded file's filename
    let filename;
    if (req.file) {
      filename = req.file.filename;
    }

    try {
      // Hash the password
      const hashedPassword = await bcrypt.hash(req.body.password, 10);

      // Create a user object with the provided data and the hashed password and filename (if any)
      const user = new User({
        username: req.body.username,
        email: req.body.email,
        password: hashedPassword,
        avatar: filename || null
      });

      // Save the user document to the database
      const savedUser = await user.save();
      console.log('User saved to database:', savedUser);
      res.json(savedUser);
    } catch (error) {
      console.error('Error saving user to database:', error.message);
      res.status(500).json({ message: 'Internal server error' });
    }
  });
});







app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }
    const token = jwt.sign({ userId: user._id }, secret, { expiresIn: '1h' });
    res.status(200).json({ user, token });
  } catch (error) {
    res.status(500).json({ message: 'Error logging in', error });
  }
});


app.get('/api/rooms', async (req, res) => {
  try {
    const rooms = await Room.find().populate('members', 'username');
    res.status(200).json(rooms);
  } catch (error) {
    res.status(500).json({ message: 'Error getting rooms', error });
  }
});

app.post('/api/rooms', async (req, res) => {
  try {
    const { name, description, password } = req.body;
    const roomId = generateUniqueId();
    const url = `http://localhost:3000/room/${roomId}`;
    // Create a new room
    const room = new Room({
      name,
      description,
      password,
      isPrivate: !!password,
      url,
    });
    
    // Save the room to the database
    await room.save();
    
    res.status(201).json(room);
  } catch (error) {
    res.status(500).json({ message: 'Error creating room', error });
  }
});

  app.get('/api/rooms/:roomId', async (req, res) => {
    try {
      const { roomId } = req.params;
  
      // Find the room by id
      const room = await Room.findById(roomId).populate('members', 'username');
      
      if (!room) {
        return res.status(404).json({ message: 'Room not found' });
      }
      
      res.status(200).json(room);
    } catch (error) {
      res.status(500).json({ message: 'Error getting room', error });
    }
  });
  
  app.put('/api/rooms/:roomId', async (req, res) => {
    try {
      const { roomId } = req.params;
      const { name, members } = req.body;
  
      // Find the room by id
      const room = await Room.findById(roomId);
      
      if (!room) {
        return res.status(404).json({ message: 'Room not found' });
      }
      
      // Update the room
      room.name = name || room.name;
      room.members = members || room.members;
      
      // Save the updated room to the database
      await room.save();
      
      res.status(200).json(room);
    } catch (error) {
      res.status(500).json({ message: 'Error updating room', error });
    }
  });
  
  app.delete('/api/rooms/:roomId', async (req, res) => {
    try {
      const { roomId } = req.params;
  
      // Find the room by id and delete it
      await Room.findByIdAndDelete(roomId);
      
      res.status(200).json({ message: 'Room deleted successfully' });
    } catch (error) {
      res.status(500).json({ message: 'Error deleting room', error });
    }
  });
// add websocket server

const server = app.listen(4000, () => console.log('Server started on port 4000'));

const io = require('socket.io')(server, {
  cors: {
    origin: '*',
  }
});

// backend
io.on("connection", (socket) => {
  console.log(`User Connected: ${socket.id}`);

  socket.on("join_room", (data) => {
    socket.join(data);
    console.log(`User with ID: ${socket.id} joined room: ${data}`);
  });

  socket.on("send_message", (data) => {
    socket.to(data.room).emit("receive_message", data);
  });

  socket.on("disconnect", () => {
    console.log("User Disconnected", socket.id);
  });
});


  


  app.listen(3000, () => console.log('Server started on port 3000'));
  
