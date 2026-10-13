<?php
// Run native Laravel Artisan with a task-owned development router.
require __DIR__.'/local-runtime.php';
$app->bind(Illuminate\Foundation\Console\ServeCommand::class, function () {
    return new class extends Illuminate\Foundation\Console\ServeCommand
    {
        protected function serverCommand(): array
        {
            $command = parent::serverCommand();
            $command[count($command)-1] = __DIR__.'/local-router.php';

            return $command;
        }
    };
});
exit($app->handleCommand(new Symfony\Component\Console\Input\ArgvInput($argv)));
