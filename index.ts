import { Server } from 'socket.io';
import { record } from './recorder';

const options = {
  cors: {
    origin: '*', // Add the 'origin' property
    methods: ['GET', 'POST'], // Add the 'methods' property
  },
};

const io: Server = new Server(3131, options);

io.on("connection", (socket) => {
  console.log("a user connected");

  socket.on("disconnect", () => {
    console.log("user disconnected");
  })
});

record();

export { io };