<?php
require __DIR__.'/source-directory.php';
$public = $root.'/apps/api/public';
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if ($path !== '/' && is_file($public.$path)) { return false; }
define('LARAVEL_START', microtime(true));
require __DIR__.'/local-runtime.php';
$app->handleRequest(Illuminate\Http\Request::capture());
