use shuriken_service::auth::password::hash_password;

fn main() {
    let password = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "password".to_string());

    match hash_password(&password) {
        Ok(hash) => {
            println!("{hash}");
        }
        Err(err) => {
            eprintln!("Failed to hash password: {err}");
            std::process::exit(1);
        }
    }
}
