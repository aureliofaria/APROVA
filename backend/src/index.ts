import express from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';
import authRouter from './routes/auth';
import usersRouter from './routes/users';
import departmentsRouter from './routes/departments';
import sectorsRouter from './routes/sectors';
import flowsRouter from './routes/flows';
import requestsRouter from './routes/requests';
import tasksRouter from './routes/tasks';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/departments', departmentsRouter);
app.use('/api/sectors', sectorsRouter);
app.use('/api/flows', flowsRouter);
app.use('/api/requests', requestsRouter);
app.use('/api/tasks', tasksRouter);

app.listen(PORT, () => console.log(`APROVA API rodando na porta ${PORT}`));
export default app;
