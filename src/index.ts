import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'node:path';
import { env } from './config/env';
import {
  modelsRouter,
  routeRouter,
  breakersRouter,
  telemetryRouter,
  dashboardRouter,
} from './routes/index';

export const app = express();
const startedAt = Date.now();

app.use(helmet());
app.use(morgan('tiny'));
app.use(express.json({ limit: '8mb' }));

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'agent-router',
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    nodeEnv: env.nodeEnv,
  });
});

app.use('/api/models', modelsRouter);
app.use('/api/route', routeRouter);
app.use('/api/breakers', breakersRouter);
app.use('/api/telemetry', telemetryRouter);
app.use('/api/dashboard', dashboardRouter);
if (env.nodeEnv !== 'production') app.use('/demo', express.static(path.join(__dirname, '..', 'dashboard-preview')));

app.use((_req, res) => { res.status(404).json({ error: 'Not found' }); });

if (require.main === module) {
  if (env.nodeEnv === 'production') {
    console.error('[agent-router] production start disabled: this fixture API has no authentication or provider dispatch.');
    process.exitCode = 1;
  } else {
    app.listen(env.port, '127.0.0.1', () => {
      console.log(`agent-router demo listening on 127.0.0.1:${env.port}`);
    });
  }
}
