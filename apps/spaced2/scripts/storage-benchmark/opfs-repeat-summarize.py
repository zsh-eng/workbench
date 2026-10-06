#!/usr/bin/env python3
"""Summarize all accepted repeat samples without discarding slower cases."""
import json
from pathlib import Path
import statistics
import sys
import math

data=json.loads(Path(sys.argv[1]).read_text())
samples=data['samples']
def percentile(values,p):
    return sorted(values)[max(0,math.ceil(len(values)*p)-1)]
summary={}
for engine in ('dexie','native-idb','opfs','native-idb-strict'):
    summary[engine]={}
    for scope in ('all','main'):
        selected=[s for s in samples if s['engine']==engine and s['scope']==scope]
        if not selected: continue
        assert all(s['verified'] and s['cleaned'] for s in selected)
        summary[engine][scope]={
            'n':len(selected),
            'writeMedianMs':statistics.median(s['writeMs'] for s in selected),
            'writeRangeMs':[min(s['writeMs'] for s in selected),max(s['writeMs'] for s in selected)],
            'writeSamplesMs':[s['writeMs'] for s in selected],
            'prepareMedianMs':statistics.median(s['prepareMs'] for s in selected),
            'setupSamplesMs':[s['setupMs'] for s in selected],
            'prepareSetupWriteMedianMs':statistics.median(s['prepareMs']+s['setupMs']+s['writeMs'] for s in selected),
            'readMedianMs':statistics.median(s['readMs'] for s in selected),
        }
        if scope=='all':
            points={}
            for workload in ('insert','update','insert+outbox','update+outbox'):
                values=[t for s in selected for group in s['pointResults'] if group['workload']==workload for t in group['latenciesMs']]
                points[workload]={'n':len(values),'p50Ms':percentile(values,.5),'p95Ms':percentile(values,.95),'maxMs':max(values),'meanMs':statistics.mean(values)}
            summary[engine]['points']=points
print(json.dumps(summary,indent=2))
