
import { Command } from 'commander';
const program = new Command();

import { sayHello } from './hello';

program.command('say-hello')
  .description('Say hello')
  .action(sayHello);



program.parse();