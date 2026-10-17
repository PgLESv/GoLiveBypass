import { spawn } from 'child_process';

const sh = (cmd: string, args: string[]) =>
  new Promise<void>(res => spawn(cmd, args, { stdio: 'ignore' }).on('error', () => res()).on('close', () => res()));

export function isDiscordRunning(): Promise<boolean> {
  return new Promise(res => {
    spawn('pgrep', ['-x', 'Discord'], { stdio: 'ignore' })
      .on('error', () => res(false))
      .on('close', code => res(code === 0));
  });
}

export async function restartDiscord(): Promise<void> {
  await sh('osascript', ['-e', 'tell application "Discord" to quit']).catch(() => {});
  await new Promise(r => setTimeout(r, 1500));
  await sh('pkill', ['-x', 'Discord']).catch(() => {});
  await new Promise(r => setTimeout(r, 500));
  await sh('open', ['-a', 'Discord']);
}
