import { Server } from 'socket.io';
import { startStream } from './recorder';

const options = {
  cors: {
    origin: '*', // Add the 'origin' property
    methods: ['GET', 'POST'], // Add the 'methods' property
  },
};

const io: Server = new Server(3131, options);

io.on("connection", (socket) => {
  console.log("a user connected");

  socket.on("transcript", (transcript: string) => {
    io.emit("transcript", transcript);
  })

  socket.on("disconnect", () => {
    console.log("user disconnected");
  })
});

startStream();

export { io };