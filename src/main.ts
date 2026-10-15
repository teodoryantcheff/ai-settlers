import { bootGame, reportBootError } from './bootstrap.ts';

bootGame().catch(reportBootError);
