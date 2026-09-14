"""Create a console-independent Windows service process with direct file logging.

No shell, inherited console, redirected pipe reader, elevation, or persistent
supervisor is involved. The caller records the returned PID and creation time.
"""
import base64
import json
import os
import subprocess
import sys


def main():
    if os.name != 'nt':
        raise RuntimeError('This launcher requires Windows')
    request = json.loads(base64.b64decode(sys.argv[1]).decode('utf-8'))
    command = subprocess.list2cmdline([request['executable']]) + ' ' + request['arguments']
    # Popen duplicates the file handles into the child. Closing our copies on
    # return cannot close the child's handles; no PowerShell output pump survives.
    with open(request['log'], 'ab', buffering=0) as log:
        child = subprocess.Popen(
            command, executable=request['executable'], cwd=request['working'],
            stdin=subprocess.DEVNULL, stdout=log, stderr=log, close_fds=True,
            creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP,
        )
    print(child.pid, flush=True)


if __name__ == '__main__':
    main()
