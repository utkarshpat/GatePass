import {run} from "./load-stress/Runner.ts";
run().catch(()=>{process.exitCode=1;});
