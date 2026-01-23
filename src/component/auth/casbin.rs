use casbin::CoreApi;
use diesel::{
    PgConnection,
    r2d2::{ConnectionManager, Pool},
};

pub async fn init_casbin(
    pool: Pool<ConnectionManager<PgConnection>>,
) -> Result<casbin::Enforcer, casbin::Error> {
    let model = casbin::DefaultModel::from_str(include_str!("casbin_model.conf")).await?;

    let adapter = diesel_adapter::DieselAdapter::with_pool(pool)?;

    casbin::Enforcer::new(model, adapter).await
}
