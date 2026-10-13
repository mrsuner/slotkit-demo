<?php
require __DIR__.'/local-runtime.php';
exit($app->handleCommand(new Symfony\Component\Console\Input\ArgvInput($argv)));
