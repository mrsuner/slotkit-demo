<?php
require __DIR__.'/local-runtime.php';
App\Models\CalendarConnection::query()->where('tenant_id',$fixture['tenant_id'])->increment('busy_cache_generation');
