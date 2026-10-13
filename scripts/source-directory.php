<?php
$root = realpath(getenv('SLOTKIT_SOURCE_DIR') ?: dirname(__DIR__, 2).'/slotkit');
if ($root === false || ! is_file($root.'/apps/api/artisan')) {
    throw new RuntimeException('Set SLOTKIT_SOURCE_DIR to your local Slotkit source checkout.');
}
