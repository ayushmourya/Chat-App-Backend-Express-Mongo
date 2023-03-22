
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const http = require("http");
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
const { ObjectId } = require('mongodb');
const path = require('path');
const fs = require('fs');



const { GridFsBucket } = mongoose.mongo;


const generateUniqueId = require('generate-unique-id');
const { fstat } = require('fs');
const storage = multer.diskStorage({
  destination: './uploads/',
  filename: function(req, file, cb) {
    cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    limits: { fileSize: 10 * 1024 * 1024 }
  },
  fileFilter: function(req, file, cb) {
    checkFileType(file, cb);
  }
}).single('avatar');


function checkFileType(file, cb) {
  
  const filetypes = /jp eg|jpg|png|gif/;

  const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

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
app.use(express.static('uploads'));


mongoose.connect('mongodb+srv://ayush:admin@cluster0.ml11umh.mongodb.net/?retryWrites=true&w=majority', { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('Connected to MongoDB'))
  .catch(error => console.log('Error connecting to MongoDB', error));

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
  owner: { type: String, required: true },
  url: { type: String, required: false },
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

const secret = 'secret123';

app.get('/healthcheck', (req, res) => {
  res.send('OK');
});

app.get('/authors', (req, res) => {
  res.send({author: 'MAVG'});
});


app.post('/api/chitchat/register', (req, res) => {
  upload(req, res, async (err) => {
    if (err) {
      console.error(err);
      return res.status(400).json({ message: err.message });
    }

    if (!req.body.username || !req.body.email || !req.body.password) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    let filename;
    if (req.file) {
      filename = req.file.filename;
    }

    try {
      const hashedPassword = await bcrypt.hash(req.body.password, 10);

      const user = new User({
        username: req.body.username,
        email: req.body.email,
        password: hashedPassword,
        avatar: filename || null
      });

      const savedUser = await user.save();
      console.log('User saved to database:', savedUser);
      res.json(savedUser);
    } catch (error) {
      console.error('Error saving user to database:', error.message);
      res.status(500).json({ message: 'Internal server error' });
    }
  });
});







app.post('/api/chitchat/login', async (req, res) => {
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
    const userWithAvatarUrl = { 
      username: user.username, 
      email: user.email, 
      avatar: `/api/chitchat/${user.avatar}`,
    };
    res.status(200).json({ user: userWithAvatarUrl, token });
  } catch (error) {
    res.status(500).json({ message: 'Error logging in', error });
  }
});




app.get('/api/chitchat/rooms', async (req, res) => {
  try {
    const rooms = await Room.find().populate('members', 'username');
    res.status(200).json(rooms);
  } catch (error) {
    res.status(500).json({ message: 'Error getting rooms', error });
  }
});

// get avatar from uploud folder and send it to the client
// app.get('/img', (req, res) => {
//   fs.Readfile('./uploads/' + req.query.filename, (err, data) => {
//     if (err) {
//       console.log(err);
//       res.status(500).json({ message: 'Error getting avatar', err });
//     }
//     res.writeHead(200, { 'Content-Type': 'image/jpeg' });
//     res.end(data);
//   });
// });

app.post('/api/chitchat/rooms', async (req, res) => {
  try {
    const { name, description, password, owner } = req.body;
    const roomId = generateUniqueId();
    const url = `/api/chitchat/room/${roomId}`;
    
    const room = new Room({
      name,
      description,
      password,
      isPrivate: !!password,
      url,
      owner, 
    });
    
    await room.save();
    
    res.status(201).json(room);
  } catch (error) {
    res.status(500).json({ message: 'Error creating room', error });
  }
});

  app.get('/api/chitchat/rooms/:roomId', async (req, res) => {
    try {
      const { roomId } = req.params;
  
      const room = await Room.findById(roomId).populate('members', 'username');
      
      if (!room) {
        return res.status(404).json({ message: 'Room not found' });
      }
      
      res.status(200).json(room);
    } catch (error) {
      res.status(500).json({ message: 'Error getting room', error });
    }
  });
  
  app.put('/api/chitchat/rooms/:roomId', async (req, res) => {
    try {
      const { roomId } = req.params;
      const { name, members } = req.body;
  
      const room = await Room.findById(roomId);
      
      if (!room) {
        return res.status(404).json({ message: 'Room not found' });
      }
      
      room.name = name || room.name;
      room.members = members || room.members;
      
      await room.save();
      
      res.status(200).json(room);
    } catch (error) {
      res.status(500).json({ message: 'Error updating room', error });
    }
  });



  app.get('/api/chitchat/user/:username', async (req, res) => {
    try {
      const { username } = req.params;
      const user = await User.findOne({ username }).select('-password');
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      res.status(200).json(user);
    } catch (error) {
      res.status(500).json({ message: 'Error getting user', error });
    }
  });


app.get('/api/chitchat/users', async (req, res) => {
  try {
    const users = await User.find().select('-password');
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ message: 'Error getting users', error });
  }
});







app.post('/api/chitchat/messages', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.body.sender });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
  
    const message = new Message({
      text: req.body.text,
      sender: user._id,
      room: ObjectId(req.body.room),
    });
    await message.save();
    res.json(message);
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server error" });
  }
});

app.get('/api/chitchat/messages', async (req, res) => {
  try {
    const messages = await Message.find({ room: ObjectId(req.query.room) }).populate('sender', 'username');
    res.json(messages);
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server error" });
  }
});
  
  app.delete('/api/chitchat/rooms/:roomId', async (req, res) => {
    try {
      const { roomId } = req.params;
  
      // Find the room by id and delete it
      await Room.findByIdAndDelete(roomId);
      
      res.status(200).json({ message: 'Room deleted successfully' });
    } catch (error) {
      res.status(500).json({ message: 'Error deleting room', error });
    }
  });


const server = http.createServer(app);

const io = require('socket.io')(server, {
  cors: {
    origin: '*',
  }
});

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




server.listen(8900, () => {
  console.log("SERVER RUNNING");
});  
