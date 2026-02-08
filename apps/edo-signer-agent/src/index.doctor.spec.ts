import { formatDoctorReport, type DoctorInfo } from './index';

describe('index --doctor', () => {
  test('formatDoctorReport prints required diagnostics', () => {
    const info: DoctorInfo = {
      platform: 'win32',
      execPath: 'C:\\Program Files\\vrplike-signer\\vrplike-signer.exe',
      cwd: 'C:\\Users\\x',
      env: {
        APPDATA: 'C:\\Users\\x\\AppData\\Roaming',
        USERPROFILE: 'C:\\Users\\x',
        HOMEDRIVE: 'C:',
        HOMEPATH: '\\Users\\x',
      },
      osHomedir: 'C:\\Users\\x',
      appDataFallback: 'C:\\Users\\x\\AppData\\Roaming',
      agentJsonPath: 'C:\\Users\\x\\AppData\\Roaming\\vrplike-signer\\agent.json',
      registryCheck: {
        ok: false,
        exitCode: 1,
        command: 'reg.exe query "HKCU\\\\Software\\\\Classes\\\\vrplike-signer\\\\shell\\\\open\\\\command"',
        stdout: '',
        stderr: 'ERROR: The system was unable to find the specified registry key or value.',
      },
    };

    const out = formatDoctorReport(info);
    expect(out).toContain('platform: win32');
    expect(out).toContain(`process.execPath: ${info.execPath}`);
    expect(out).toContain(`process.cwd(): ${info.cwd}`);
    expect(out).toContain(`env.APPDATA: ${info.env.APPDATA}`);
    expect(out).toContain(`env.USERPROFILE: ${info.env.USERPROFILE}`);
    expect(out).toContain('env.HOMEDRIVE+env.HOMEPATH: C:\\Users\\x');
    expect(out).toContain(`os.homedir(): ${info.osHomedir}`);
    expect(out).toContain(`calculated appDataFallback: ${info.appDataFallback}`);
    expect(out).toContain(`agent.json: ${info.agentJsonPath}`);
    expect(out).toContain('registry vrplike-signer://: NO');
    expect(out).toContain('registry command: reg.exe query');
    expect(out).toContain('registry output:');
  });
});

