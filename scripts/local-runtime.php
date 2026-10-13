<?php
// Verification harness only. Calls with this fixture's token are intercepted;
// other credentials and production code are untouched. No real Google calls for this fixture.
require __DIR__.'/source-directory.php';
require $root.'/apps/api/vendor/autoload.php';
$app = require $root.'/apps/api/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (! $app->environment('local')) { throw new RuntimeException('Local only'); }
$fixture = json_decode(file_get_contents(dirname(__DIR__).'/data/fixture.json'), true, flags: JSON_THROW_ON_ERROR);
$token = 'Bearer slotkit-demo-'.$fixture['tenant_id'];
Illuminate\Support\Facades\Http::fake(function ($request) use ($token) {
    if (($request->header('Authorization')[0] ?? '') !== $token) { return null; }
    if (is_file(dirname(__DIR__).'/data/calendar-unavailable')) { return Illuminate\Support\Facades\Http::response([],503); }
    $path = parse_url($request->url(), PHP_URL_PATH);
    if ($path === '/calendar/v3/freeBusy') {
        $calendars = [];
        foreach ($request['items'] as $item) { $calendars[$item['id']] = ['busy'=>[]]; }
        return Illuminate\Support\Facades\Http::response(['calendars'=>$calendars]);
    }
    if (preg_match('~/calendar/v3/calendars/[^/]+/events(?:/([^/]+))?$~', $path, $matches)) {
        $file = dirname(__DIR__).'/data/calendar-events.json';
        $stream = fopen($file, 'c+'); chmod($file,0600); flock($stream, LOCK_EX);
        $events = json_decode(stream_get_contents($stream), true) ?? [];
        $id = $matches[1] ?? $request['id'];
        $status = 200; $result = [];
        if ($request->method() === 'DELETE') { unset($events[$id]); }
        elseif ($request->method() === 'GET') { $result = $events[$id] ?? []; $status = isset($events[$id]) ? 200 : 404; }
        else { $result = ['id'=>$id]; $events[$id]=$result; }
        rewind($stream); ftruncate($stream,0); fwrite($stream,json_encode($events,JSON_THROW_ON_ERROR)); fflush($stream); flock($stream,LOCK_UN); fclose($stream);
        return Illuminate\Support\Facades\Http::response($result,$status);
    }
    return Illuminate\Support\Facades\Http::response(['error'=>'Synthetic provider route unavailable'],503);
});
