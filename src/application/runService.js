import { CoreContractError } from '../core/contracts.js';
import { transitionRun } from '../domain/run.js';

export function createRunService({ repository }) {
  const control = async (command, input, actor, runtimeControl) => {
    if (!input?.requestId || !input?.runId || !Number.isInteger(input.expectedVersion)) throw new CoreContractError('invalid_request','Valid Run control input is required');
    if (!runtimeControl?.activate || !runtimeControl?.halt) throw new CoreContractError('runtime_control_required','Host runtime control is required');
    const operation=`run_${command}`;
    const prior=await repository.getOperationReplay(operation,input.requestId,'margin_runs');
    if (prior) return {ok:true,...prior};
    const current=await repository.getRun(input.runId);
    if (!current) throw new CoreContractError('run_not_found','Run not found');
    if (current.version !== input.expectedVersion) throw new CoreContractError('version_conflict','Run version conflict');
    const status=transitionRun(current,{type:command}).status;
    if (command==='start' || command==='resume') {
      const activated=await runtimeControl.activate(current);
      try {
        return {ok:true,...await repository.transitionRun({...input,command,status,runtimeSessionId:activated?.runtimeSessionId,checkpoint:false},actor)};
      } catch (error) {
        await runtimeControl.halt({...current,...activated}).catch(()=>{});
        throw error;
      }
    }
    await runtimeControl.halt(current);
    return {ok:true,...await repository.transitionRun({...input,command,status,checkpoint:['pause','stop','complete'].includes(command)},actor)};
  };
  return {
    async create(input, actor) {
      if (!input?.requestId || !input?.workstreamId || !input?.scope?.trim() || !input?.runtimeKind) throw new CoreContractError('invalid_request','Valid Run input is required');
      return { ok: true, ...await repository.createRun(input, actor) };
    },
    get: repository.getRun,
    findOpen: repository.findOpenRun,
    start: (input,actor,runtime) => control('start',input,actor,runtime),
    pause: (input,actor,runtime) => control('pause',input,actor,runtime),
    resume: (input,actor,runtime) => control('resume',input,actor,runtime),
    stop: (input,actor,runtime) => control('stop',input,actor,runtime),
    complete: (input,actor,runtime) => control('complete',input,actor,runtime)
  };
}
