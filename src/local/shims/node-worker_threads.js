import {worker_threads} from './node-misc.js';
export const {Worker, isMainThread, parentPort, workerData} = worker_threads;
export default worker_threads;
