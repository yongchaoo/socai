import { invoke } from '@tauri-apps/api/core';
export const open = () => invoke('open_file');
export const save = () => invoke('save_file');
