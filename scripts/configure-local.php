<?php
// Test provisioning only. The customer application does not import Slotkit internals.
require __DIR__.'/source-directory.php';
require $root.'/apps/api/vendor/autoload.php';
$app = require $root.'/apps/api/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (! $app->environment('local')) { throw new RuntimeException('Local only'); }
$path = dirname(__DIR__).'/data/fixture.json';
$f = json_decode(file_get_contents($path), true, flags: JSON_THROW_ON_ERROR);
$t = App\Models\Tenant::query()->findOrFail($f['tenant_id']);
$u = App\Models\User::query()->findOrFail($f['owner_user_id']);
// Replace the broad harness key with the four scopes this demo actually needs.
foreach (App\Models\ApiKey::query()->where('tenant_id',$t->id)->whereIn('name',['SDK E2E full access','Booking demo'])->where('status','active')->get() as $key) {
    app(App\Application\Services\ApiKeys\ApiKeyService::class)->revoke($key,$u);
}
$f['api_key'] = app(App\Application\Services\ApiKeys\ApiKeyService::class)->create($t,$u,'Booking demo',['event_types:read','slots:read','bookings:read','bookings:write'],now()->addDays(7))->credential;
app(App\Application\Services\Billing\CreditLedgerService::class)->initializeTenant($t);
$schedule = App\Models\AvailabilitySchedule::query()->where('tenant_id',$t->id)->firstOrFail();
for ($weekday=1; $weekday<=7; $weekday++) {
    App\Models\AvailabilityWeeklyRule::query()->firstOrCreate([
        'tenant_id'=>$t->id,'availability_schedule_id'=>$schedule->id,'weekday'=>$weekday,'start_minute'=>540,'end_minute'=>1020,
    ]);
}
App\Models\EventType::query()->where('tenant_id', $t->id)->update(['calendar_guest_updates'=>'none', 'guest_booking_notifications_enabled'=>false]);
App\Models\EventType::query()->whereKey($f['event_type_id'])->update(['name'=>'A conversation with North Studio']);
$c = App\Models\CalendarConnection::query()->where('tenant_id',$t->id)->firstOrFail();
$c->update(['encrypted_access_token'=>app(App\Application\Services\Calendar\CalendarCredentialVault::class)->encrypt('slotkit-demo-'.$t->id)]);
file_put_contents($path,json_encode($f,JSON_THROW_ON_ERROR)); chmod($path,0600);
$env = 'SLOTKIT_BASE_URL=http://127.0.0.1:8000'."\n".'SLOTKIT_API_KEY='.$f['api_key']."\n".'SLOTKIT_EVENT_TYPE_ID='.$f['event_type_id']."\n".'DEMO_ORIGIN=http://127.0.0.1:3000'."\nDEMO_PORT=3000\n";
file_put_contents(dirname(__DIR__).'/.env',$env); chmod(dirname(__DIR__).'/.env',0600);
echo "Configured a synthetic workspace and server-only demo key.\n";
